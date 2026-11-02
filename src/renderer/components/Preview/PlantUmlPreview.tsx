import React, { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { renderLocalPlantuml } from './localPlantuml'
import { ShadowWhiteContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

const PlantUmlPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { t } = useTranslation()
  const renderController = useRef<AbortController | null>(null)
  const renderPlantUml = useCallback(
    async (content: string, container: HTMLDivElement) => {
      renderController.current?.abort()
      const controller = new AbortController()
      renderController.current = controller
      try {
        const svg = await renderLocalPlantuml(content, controller.signal)
        if (!controller.signal.aborted) renderSvgInShadowHost(svg, container)
      } catch (error) {
        if (controller.signal.aborted) return
        throw new Error(t('preview.plantuml.local_error', { reason: error instanceof Error ? error.message : '' }))
      }
    },
    [t]
  )

  useEffect(() => () => renderController.current?.abort(), [])

  // 使用预览渲染器 hook
  const { containerRef, error, isLoading } = useDebouncedRender(children, renderPlantUml, {
    debounceDelay: 300
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="plantuml">
      <ShadowWhiteContainer
        ref={containerRef}
        className="plantuml-preview special-preview flex items-center justify-center"
      />
    </ImagePreviewLayout>
  )
}

export default memo(PlantUmlPreview)
