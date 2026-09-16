import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export async function generatePDF(inv, logoBase64) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
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
    return [
      it.label,
      it.description || '',
      String(qty),
      fmtMoney(price),
      fmtMoney(qty * price),
    ]
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
  }

  const ph = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(inv.companyName || '', pw / 2, ph - 20, { align: 'center' })

  if (inv.type === 'receipt' || inv.status === 'paid') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(110)
    doc.setTextColor(187, 247, 208)
    doc.text('PAID', pw / 2, ph / 2 + 40, { align: 'center', angle: 40 })
  }

  return doc
}
