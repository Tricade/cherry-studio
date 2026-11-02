import AdmZip from 'adm-zip'
import { parseOffice } from 'officeparser'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { extractPdfText } from '@main/utils/pdf'

describe('Office document extraction engines', () => {
  it('extracts Unicode text from a DOCX in memory', async () => {
    const archive = new AdmZip()
    archive.addFile(
      '[Content_Types].xml',
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    )
    archive.addFile(
      'word/document.xml',
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello 世界</w:t></w:r></w:p></w:body></w:document>'
      )
    )

    const document = await parseOffice(archive.toBuffer())
    expect(document.toText()).toContain('Hello 世界')
  })

  it('extracts PDF text with the existing local PDF parser', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage().drawText('Local PDF extraction', { font })

    expect(await extractPdfText(Buffer.from(await pdf.save()))).toContain('Local PDF extraction')
  })
})
