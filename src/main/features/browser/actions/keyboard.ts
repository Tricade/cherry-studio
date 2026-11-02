import { isMac } from '@main/core/platform'

import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserRef } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { KeyModifier, resolveKeyDefinition, TEXT_SUPPRESSING_MODIFIERS } from './keyDefinitions'
import { callOnElement, withElement } from './resolveTarget'

function sendGuestKey(session: GuestSession, event: Electron.KeyboardInputEvent, options: BrowserActionOptions) {
  options.signal?.throwIfAborted()
  if (options.deadline !== undefined && options.deadline <= Date.now()) throw new BrowserSessionError('timeout')
  if (!session.isAvailable()) throw new BrowserSessionError('debugger_unavailable')
  if (session.pendingDialog) throw new BrowserSessionError('dialog_open', session.pendingDialog)
  session.guest.sendInputEvent(event)
}

export async function pressKey(session: GuestSession, chord: string, options: BrowserActionOptions) {
  const parts = chord.split('+')
  let input = parts.pop()!
  if (!input && parts.at(-1) === '') {
    parts.pop()
    input = '+'
  }
  let modifiers = 0
  for (const part of parts) {
    if (!Object.hasOwn(KeyModifier, part)) throw new BrowserSessionError('not_allowed')
    modifiers |= KeyModifier[part as keyof typeof KeyModifier]
  }
  const definition = resolveKeyDefinition(input, Boolean(modifiers & KeyModifier.Shift))
  if (!definition) throw new BrowserSessionError('not_allowed')
  await options.focusInput?.(options)
  const { key, code, windowsVirtualKeyCode } = definition
  const text =
    modifiers & TEXT_SUPPRESSING_MODIFIERS
      ? undefined
      : key === 'Enter'
        ? '\r'
        : [...key].length === 1
          ? key
          : undefined
  const params = { key, code, windowsVirtualKeyCode, modifiers }
  if (session.ownership === 'borrowed') {
    await session.send('Runtime.evaluate', { expression: 'void 0' }, options)
    const keyCode = key.startsWith('Arrow') ? key.slice(5) : key === ' ' ? 'Space' : key === '+' ? 'Plus' : key
    const modifierNames = (
      [
        ['alt', KeyModifier.Alt],
        ['control', KeyModifier.Control],
        ['meta', KeyModifier.Meta],
        ['shift', KeyModifier.Shift]
      ] as const
    )
      .filter(([, bit]) => modifiers & bit)
      .map(([name]) => name)
    sendGuestKey(session, { type: 'keyDown', keyCode, modifiers: modifierNames }, options)
    try {
      if (text) sendGuestKey(session, { type: 'char', keyCode: text, modifiers: modifierNames }, options)
    } finally {
      if (!session.guest.isDestroyed())
        session.guest.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifierNames })
    }
    await session.send('Runtime.evaluate', { expression: 'void 0' }, options)
    return
  }
  const selectAll = modifiers === (isMac ? KeyModifier.Meta : KeyModifier.Control) && key.toLowerCase() === 'a'
  await session.send(
    'Input.dispatchKeyEvent',
    { ...params, type: 'rawKeyDown', ...(selectAll ? { commands: ['selectAll'] } : {}) },
    options
  )
  if (text)
    await session.send('Input.dispatchKeyEvent', { ...params, type: 'char', text, unmodifiedText: text }, options)
  await session.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, options)
}

export async function typeText(
  session: GuestSession,
  ref: BrowserRef,
  text: string,
  clear: boolean,
  submit: boolean,
  options: BrowserActionOptions
) {
  if (session.ownership === 'borrowed') text = text.replace(/\r\n?/g, '\n')
  await withElement(
    session,
    ref,
    async (objectId, backendNodeId, check) => {
      const initial = await callOnElement<{ editable: boolean; value: string; multiline: boolean }>(
        session,
        objectId,
        `function(){
      const editable = this.isConnected && !this.disabled && !this.readOnly && (this.isContentEditable || this.tagName === 'TEXTAREA' || (this.tagName === 'INPUT' && ['text','search','email','url','tel','password','number'].includes(this.type)));
      return { editable, value: this.value ?? this.textContent ?? '', multiline: this.isContentEditable || this.tagName === 'TEXTAREA' }
    }`,
        [],
        options
      )
      if (!initial.editable) throw new BrowserSessionError('not_found')
      if (session.ownership === 'borrowed' && !initial.multiline && /[\r\n]/.test(text))
        throw new BrowserSessionError('not_allowed')
      check()
      await options.focusInput?.(options)
      options = { ...options, focusInput: undefined }
      check()
      await session.send('DOM.focus', { backendNodeId }, options)
      const checkFocusedTarget = async () => {
        check()
        const focused = await callOnElement<boolean>(
          session,
          objectId,
          'function(){ return this.isConnected && this.getRootNode().activeElement === this }',
          [],
          options
        )
        if (!focused) throw new BrowserSessionError('not_found')
      }
      if (session.ownership === 'borrowed') await checkFocusedTarget()
      const clearField = async () => {
        check()
        await pressKey(session, `${isMac ? 'Meta' : 'Control'}+a`, options)
        await pressKey(session, 'Backspace', options)
      }
      if (clear) await clearField()
      else {
        const positioned = await callOnElement<boolean>(
          session,
          objectId,
          `function(){
          if(this.setSelectionRange && this.selectionStart !== null){ this.setSelectionRange(this.value.length, this.value.length); return true }
          if(this.isContentEditable){ const r=document.createRange(); r.selectNodeContents(this); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true }
          return false
        }`,
          [],
          options
        )
        if (!positioned) await pressKey(session, isMac ? 'Meta+ArrowRight' : 'End', options)
      }
      check()
      if (session.ownership === 'borrowed') {
        for (const character of text) {
          await checkFocusedTarget()
          // Electron's character event uses a carriage return for a line break, without an Enter keydown.
          sendGuestKey(session, { type: 'char', keyCode: character === '\n' ? '\r' : character }, options)
        }
      } else await session.send('Input.insertText', { text }, options)
      const expected = (clear ? '' : initial.value) + text
      const read = () =>
        callOnElement<string>(
          session,
          objectId,
          'function(){ return this.value ?? this.textContent ?? "" }',
          [],
          options
        )
      if ((await read()) !== expected) {
        if (session.ownership === 'borrowed' || /[\r\n]/.test(expected)) throw new BrowserSessionError('not_found')
        await clearField()
        for (const character of expected) {
          check()
          await pressKey(session, character === '\n' ? 'Enter' : character, options)
        }
        if ((await read()) !== expected) throw new BrowserSessionError('not_found')
      }
      check()
      if (session.ownership === 'borrowed') await checkFocusedTarget()
      if (submit) await pressKey(session, 'Enter', options)
    },
    options
  )
}
