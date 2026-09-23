import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CONTRACT_CLAUSES } from './contractClauses'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

const CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/cmaps/'

export function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Renders every page of an external PDF as JPEG images into the jsPDF doc.
async function appendExternalPdf(jsPdfDoc, pdfBytes) {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes, cMapUrl: CMAP_URL, cMapPacked: true })
  const pdfDoc = await loadingTask.promise
  const pw = jsPdfDoc.internal.pageSize.getWidth()
  const ph = jsPdfDoc.internal.pageSize.getHeight()

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page     = await pdfDoc.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

    const imgData   = canvas.toDataURL('image/jpeg', 0.88)
    const imgAspect = viewport.width / viewport.height
    const pgAspect  = pw / ph

    let imgW, imgH, imgX, imgY
    if (imgAspect > pgAspect) {
      imgW = pw; imgH = pw / imgAspect; imgX = 0; imgY = (ph - imgH) / 2
    } else {
      imgH = ph; imgW = ph * imgAspect; imgX = (pw - imgW) / 2; imgY = 0
    }

    jsPdfDoc.addPage()
    jsPdfDoc.addImage(imgData, 'JPEG', imgX, imgY, imgW, imgH)
  }
}

// Adds a footer to every page (must be called last so total count is final).
function addPageFooters(doc, inv) {
  const pw     = doc.internal.pageSize.getWidth()
  const ph     = doc.internal.pageSize.getHeight()
  const margin = 48
  const total  = doc.internal.getNumberOfPages()

  const companyInfo = [
    inv.companyAddress,
    inv.companyPhone,
    inv.companyLicense ? `Lic: ${inv.companyLicense}` : null,
  ].filter(Boolean).join('  ·  ')

  for (let p = 1; p <= total; p++) {
    doc.setPage(p)

    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.4)
    doc.line(margin, ph - 36, pw - margin, ph - 36)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(148, 163, 184)

    if (inv.invoiceNumber) doc.text(inv.invoiceNumber, margin, ph - 24)
    doc.text(inv.companyName || '', pw / 2, ph - 24, { align: 'center' })
    doc.text(`Page ${p} of ${total}`, pw - margin, ph - 24, { align: 'right' })

    if (companyInfo) {
      doc.setFontSize(7)
      doc.text(companyInfo, pw / 2, ph - 13, { align: 'center' })
    }
  }
}

function addContractSection(doc, inv, sigs = {}) {
  const pw          = doc.internal.pageSize.getWidth()
  const ph          = doc.internal.pageSize.getHeight()
  const margin      = 48
  const contentW    = pw - 2 * margin
  const FOOTER_SAFE = 76   // don't render within this many pts of bottom

  // Returns current y; adds a page and resets y if content won't fit
  function checkBreak(y, needed) {
    if (y + needed > ph - FOOTER_SAFE) {
      doc.addPage()
      return margin
    }
    return y
  }

  // Render a block of text, page-breaking mid-block if required
  function renderText(y, lines, lineH = 11) {
    let idx = 0
    while (idx < lines.length) {
      const available = Math.floor((ph - FOOTER_SAFE - y) / lineH)
      const chunk = lines.slice(idx, idx + Math.max(1, available))
      doc.text(chunk, margin, y)
      idx += chunk.length
      y += chunk.length * lineH
      if (idx < lines.length) { doc.addPage(); y = margin }
    }
    return y
  }

  // ── First page header ────────────────────────────────────────────────────────
  doc.addPage()

  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pw, 60, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text('Invoice Agreement & Terms', margin, 38)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(180, 195, 215)
  if (inv.invoiceNumber) doc.text(inv.invoiceNumber, pw - margin, 38, { align: 'right' })

  let y = 80

  // ── Reference block ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  const refs = [
    `Client:   ${inv.clientName || ''}`,
    `Invoice:  ${inv.invoiceNumber || '—'}   ·   Date: ${fmtDate(inv.issueDate)}`,
    `Total:    ${fmtMoney(inv.total)}`,
  ]
  if ((inv.claimCoveredAmount || 0) > 0) {
    refs.push(`Insurance covered: ${fmtMoney(inv.claimCoveredAmount)}`)
    const above = Math.max(0, inv.total - inv.claimCoveredAmount)
    if (above > 0) refs.push(`Amount above claim: ${fmtMoney(above)}`)
  }
  refs.forEach(line => { doc.text(line, margin, y); y += 16 })
  y += 10

  // ── Insurance scope notice box ───────────────────────────────────────────────
  if (inv.disclaimer) {
    const boxPad = 10
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const dLines = doc.splitTextToSize(inv.disclaimer, contentW - boxPad * 2)
    const boxH = dLines.length * 11 + boxPad * 2 + 16
    y = checkBreak(y, boxH + 12)
    doc.setDrawColor(165, 243, 252)
    doc.setFillColor(240, 253, 255)
    doc.roundedRect(margin, y, contentW, boxH, 3, 3, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(14, 116, 144)
    doc.text('INSURANCE SCOPE NOTICE', margin + boxPad, y + boxPad + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(8, 105, 130)
    doc.text(dLines, margin + boxPad, y + boxPad + 18)
    y += boxH + 16
  }

  // ── Section heading ──────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.line(margin, y, pw - margin, y)
  y += 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text('Standard Contract Terms & Conditions', margin, y)
  y += 18

  // ── Contract clauses ─────────────────────────────────────────────────────────
  for (const clause of CONTRACT_CLAUSES) {
    y = checkBreak(y, 36)

    // Clause title
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(37, 99, 235)
    doc.text(clause.title, margin, y)
    y += 13

    // Clause body
    const body = clause.body.replace(/\[Company Name\]/g, inv.companyName || 'the contractor')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(71, 85, 105)
    const bodyLines = doc.splitTextToSize(body, contentW)
    y = renderText(y, bodyLines, 11)
    y += 12
  }

  // ── Signature block ──────────────────────────────────────────────────────────
  const hasSigImages = !!(sigs.clientSigBase64 || sigs.contractorSigBase64)
  y = checkBreak(y, hasSigImages ? 350 : 160)
  y += 8

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pw - margin, y)
  y += 16

  // Acknowledgment
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  const ackText =
    'By signing below, I acknowledge that I have read, understood, and agree to all terms and ' +
    'conditions set forth in this invoice and agreement, including all payment obligations, ' +
    'insurance cooperation requirements, and contractor rights described above.'
  const ackLines = doc.splitTextToSize(ackText, contentW)
  doc.text(ackLines, margin, y)
  y += ackLines.length * 12 + 28

  const sigW    = 220
  const dateX   = pw - margin - 130
  const SIG_H   = 44   // vertical space reserved for an embedded signature image

  // Client signature
  if (sigs.clientSigBase64) {
    y += SIG_H
    try {
      const fmt = /data:image\/jpe?g/i.test(sigs.clientSigBase64) ? 'JPEG' : 'PNG'
      doc.addImage(sigs.clientSigBase64, fmt, margin, y - SIG_H, sigW, SIG_H - 4, undefined, 'NONE')
    } catch {}
  }
  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.6)
  doc.line(margin, y, margin + sigW, y)
  doc.line(dateX, y, pw - margin, y)
  y += 13
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text("Client's Signature", margin, y)
  doc.text(sigs.clientSignedAt || 'Date', dateX, y)

  // Print Name — write the actual name on the line in italic if provided
  y += 40
  if (sigs.clientSignerName) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(sigs.clientSignerName, margin + 4, y - 3)
  }
  doc.line(margin, y, margin + sigW, y)
  y += 13
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Print Name', margin, y)

  // Contractor signature
  y += 44
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(71, 85, 105)
  doc.text('Authorized Representative:', margin, y)
  y += 18
  if (sigs.contractorSigBase64) {
    y += SIG_H
    try {
      const fmt = /data:image\/jpe?g/i.test(sigs.contractorSigBase64) ? 'JPEG' : 'PNG'
      doc.addImage(sigs.contractorSigBase64, fmt, margin, y - SIG_H, sigW, SIG_H - 4, undefined, 'NONE')
    } catch {}
  }
  doc.setLineWidth(0.6)
  doc.setDrawColor(15, 23, 42)
  doc.line(margin, y, margin + sigW, y)
  doc.line(dateX, y, pw - margin, y)
  y += 13
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(inv.companyName || 'Company', margin, y)
  doc.text(sigs.contractorSignedAt || 'Date', dateX, y)
}

// Main PDF generator.
// opts.attachedBytes     — ArrayBuffer of a PDF to insert after the invoice pages.
// opts.includeSignature  — add a signature page at the very end (default true).
// opts.sigs              — { clientSigBase64, clientSignerName, clientSignedAt,
//                            contractorSigBase64, contractorSignerName, contractorSignedAt }
export async function generatePDF(inv, logoBase64, opts = {}) {
  const { attachedBytes = null, includeSignature = true, sigs = {} } = opts

  const doc    = new jsPDF({ unit: 'pt', format: 'letter' })
  const pw     = doc.internal.pageSize.getWidth()
  const ph     = doc.internal.pageSize.getHeight()
  const margin = 48

  // ── Header band ──
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pw, 88, 'F')

  let headerTextX = margin
  if (logoBase64) {
    try {
      const fmt = /data:image\/jpe?g/i.test(logoBase64) ? 'JPEG' : 'PNG'
      doc.addImage(logoBase64, fmt, margin, 14, 60, 60, undefined, 'NONE')
      headerTextX = margin + 72
    } catch (e) { console.warn('Logo render failed:', e) }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text(inv.companyName || 'Company', headerTextX, 38)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(180, 195, 215)
  const companyLines = [
    inv.companyAddress,
    inv.companyPhone,
    inv.companyLicense ? `License: ${inv.companyLicense}` : null,
  ].filter(Boolean)
  doc.text(companyLines.join('  ·  '), headerTextX, 54)

  const typeLabel = inv.type === 'estimate' ? 'ESTIMATE' : inv.type === 'receipt' ? 'RECEIPT' : 'INVOICE'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text(typeLabel, pw - margin, 38, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(180, 195, 215)
  doc.text(inv.invoiceNumber || '', pw - margin, 54, { align: 'right' })

  let y = 110

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('ISSUED', margin, y)
  doc.text(inv.type === 'invoice' ? 'DUE DATE' : inv.type === 'receipt' ? 'PAYMENT DATE' : 'VALID UNTIL', margin + 130, y)

  y += 13
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(fmtDate(inv.issueDate), margin, y)
  doc.text(fmtDate(inv.dueDate || inv.validUntil), margin + 130, y)

  if (inv.claimNumbers?.length) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.text('CLAIM #', margin + 280, y - 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(inv.claimNumbers.join(', '), margin + 280, y)
  }

  y += 24

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pw - margin, y)
  y += 18

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('BILL TO', margin, y)
  y += 13
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text(inv.clientName || '', margin, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  if (inv.clientAddress) { doc.text(inv.clientAddress, margin, y); y += 13 }
  if (inv.clientPhone)   { doc.text(inv.clientPhone,   margin, y); y += 13 }
  if (inv.clientEmail)   { doc.text(inv.clientEmail,   margin, y); y += 13 }

  y += 16

  const rows = (inv.lineItems || []).map(it => {
    const qty   = parseFloat(it.qty)   || 0
    const price = parseFloat(it.price) || 0
    const desc  = [it.description || '', it.taxExempt ? '(Tax Exempt)' : ''].filter(Boolean).join('\n')
    return [it.label, desc, String(qty), fmtMoney(price), fmtMoney(qty * price)]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Item', 'Description', 'Qty', 'Unit Price', 'Total']],
    body: rows,
    styles: { fontSize: 10, cellPadding: 7 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 'auto', textColor: [100, 116, 139] },
      2: { cellWidth: 90, halign: 'center' },
      3: { cellWidth: 80, halign: 'right' },
      4: { cellWidth: 80, halign: 'right', fontStyle: 'bold' },
    },
  })

  y = doc.lastAutoTable.finalY + 16

  const totW = 200
  const totX = pw - margin - totW

  const totRows = [
    ['Subtotal', fmtMoney(inv.subtotal)],
    [`Tax (${inv.taxRate || 0}%)`, fmtMoney(inv.taxAmount)],
  ]
  if (inv.discount > 0) totRows.push(['Discount', `– ${fmtMoney(inv.discount)}`])

  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  totRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal')
    doc.text(label, totX, y)
    doc.text(val, pw - margin, y, { align: 'right' })
    y += 16
  })

  doc.setFontSize(0.5)
  doc.setDrawColor(226, 232, 240)
  doc.line(totX, y - 4, pw - margin, y - 4)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text('TOTAL', totX, y + 12)
  doc.text(fmtMoney(inv.total), pw - margin, y + 12, { align: 'right' })
  y += 30

  // Insurance coverage note
  if ((inv.claimCoveredAmount || 0) > 0) {
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(8, 145, 178)
    doc.text(`Insurance covered: ${fmtMoney(inv.claimCoveredAmount)}`, totX, y)
    const above = Math.max(0, inv.total - inv.claimCoveredAmount)
    if (above > 0) {
      y += 13
      doc.setTextColor(100, 116, 139)
      doc.text(`Amount above claim: ${fmtMoney(above)}`, totX, y)
    }
    y += 8
  }

  if (inv.notes) {
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('NOTES', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(71, 85, 105)
    const noteLines = doc.splitTextToSize(inv.notes, pw - 2 * margin)
    doc.text(noteLines, margin, y)
    y += noteLines.length * 13
  }

  if (inv.terms) {
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('TERMS', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(71, 85, 105)
    const termLines = doc.splitTextToSize(inv.terms, pw - 2 * margin)
    doc.text(termLines, margin, y)
    y += termLines.length * 13
  }

  if (inv.disclaimer) {
    y += 18
    const boxPad = 10
    const boxW   = pw - 2 * margin
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    const disclaimerLines = doc.splitTextToSize(inv.disclaimer, boxW - boxPad * 2)
    const boxH = disclaimerLines.length * 11 + boxPad * 2 + 16

    // Check if we need a new page
    if (y + boxH > ph - 60) {
      doc.addPage()
      y = margin
    }

    // Bordered box
    doc.setDrawColor(203, 213, 225)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(margin, y, boxW, boxH, 4, 4, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text('DISCLAIMER', margin + boxPad, y + boxPad + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    doc.text(disclaimerLines, margin + boxPad, y + boxPad + 18)
  }

  // PAID watermark on invoice pages only (applied before appending external pages)
  if (inv.type === 'receipt' || inv.status === 'paid') {
    const invPageCount = doc.internal.getNumberOfPages()
    for (let p = 1; p <= invPageCount; p++) {
      doc.setPage(p)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(110)
      doc.setTextColor(187, 247, 208)
      doc.text('PAID', pw / 2, ph / 2 + 40, { align: 'center', angle: 40 })
    }
  }

  // ── Contract agreement & terms (page 2+, ends with client/contractor sig lines) ──
  if (includeSignature) {
    addContractSection(doc, inv, sigs)
  }

  // ── Attached reference document (after contract section) ──
  if (attachedBytes) {
    await appendExternalPdf(doc, attachedBytes)
  }

  // ── Footers on every page (must be last — needs final page count) ──
  // The backend appends its own audit/certificate page after this when signing
  addPageFooters(doc, inv)

  return doc
}
