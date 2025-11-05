import jsPDF from 'jspdf'

/**
 * Export dashboard data to PDF
 */
export async function exportDashboardToPDF(
  calls: any[],
  metrics: {
    totalCalls: number
    requiresAttention: number
    avgTalkTime: number
    avgHandleTime: number
    complianceRate: number
    custSatRate: number
  },
  dateRange: { start: Date; end: Date },
  selectedAgents: string[]
) {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let yPosition = 20

  // Title
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Agent Manager Dashboard Report', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 10

  // Date range
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  const dateText = `${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`
  pdf.text(dateText, pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 5

  // Agents filter
  if (selectedAgents.length > 0) {
    pdf.text(`Agents: ${selectedAgents.join(', ')}`, pageWidth / 2, yPosition, { align: 'center' })
  } else {
    pdf.text('Agents: All', pageWidth / 2, yPosition, { align: 'center' })
  }
  yPosition += 10

  // Metrics section
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Summary Metrics', 15, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')

  const metricsData = [
    ['Total Calls', metrics.totalCalls.toString()],
    ['Calls Requiring Attention', metrics.requiresAttention.toString()],
    ['Avg Talk Time', formatDuration(metrics.avgTalkTime)],
    ['Avg Handle Time', formatDuration(metrics.avgHandleTime)],
    ['Compliance Pass Rate', `${metrics.complianceRate.toFixed(1)}%`],
    ['Customer Satisfaction', `${metrics.custSatRate.toFixed(1)}%`],
  ]

  metricsData.forEach(([label, value]) => {
    pdf.text(`${label}:`, 15, yPosition)
    pdf.text(value, 80, yPosition)
    yPosition += 6
  })

  yPosition += 5

  // Calls table
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Call Details', 15, yPosition)
  yPosition += 8

  // Table headers
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Date/Time', 15, yPosition)
  pdf.text('Agent', 45, yPosition)
  pdf.text('Talk Time', 75, yPosition)
  pdf.text('Score', 95, yPosition)
  pdf.text('Compliance', 115, yPosition)
  pdf.text('Cust Sat', 145, yPosition)
  pdf.text('Escalation', 170, yPosition)
  yPosition += 5

  // Table rows
  pdf.setFont('helvetica', 'normal')

  calls.slice(0, 50).forEach((call) => {
    if (yPosition > pageHeight - 20) {
      pdf.addPage()
      yPosition = 20
    }

    const date = call.started_at ? new Date(call.started_at).toLocaleDateString() : 'N/A'
    const time = call.started_at ? new Date(call.started_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }) : ''
    const agent = call.agent_full_name || 'Unknown'
    const talkTime = formatDuration(call.talk_time)
    const score = call.qa?.overall_score || 'N/A'
    const compliance = call.qa?.compliance_rating || 'N/A'
    const custSat = call.qa?.customer_satisfaction_likely || 'N/A'
    const escalation = call.qa?.manager_escalation ? 'YES' : 'No'

    pdf.text(`${date} ${time}`, 15, yPosition, { maxWidth: 28 })
    pdf.text(agent, 45, yPosition, { maxWidth: 28 })
    pdf.text(talkTime, 75, yPosition)
    pdf.text(score, 95, yPosition, { maxWidth: 18 })
    pdf.text(compliance, 115, yPosition, { maxWidth: 28 })
    pdf.text(custSat, 145, yPosition, { maxWidth: 23 })

    if (escalation === 'YES') {
      pdf.setTextColor(220, 38, 38)
    }
    pdf.text(escalation, 170, yPosition)
    pdf.setTextColor(0, 0, 0)

    yPosition += 6
  })

  // Footer
  pdf.setFontSize(8)
  pdf.setTextColor(100, 100, 100)
  pdf.text(
    `Generated on ${new Date().toLocaleString()}`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  )

  // Save PDF
  const fileName = `dashboard-report-${new Date().toISOString().split('T')[0]}.pdf`
  pdf.save(fileName)
}

/**
 * Export call detail to PDF
 */
export async function exportCallDetailToPDF(call: any) {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let yPosition = 20

  const qaData = call.qa?.qa_json

  // Helper function for page breaks
  function checkPageBreak() {
    if (yPosition > pageHeight - 20) {
      pdf.addPage()
      yPosition = 20
    }
  }

  // Title
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Call Detail Report', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 10

  // Call ID
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Call ID: ${call.call_id || 'N/A'}`, pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 8

  // Manager escalation badge
  if (call.qa?.manager_escalation) {
    pdf.setFillColor(220, 38, 38)
    pdf.rect(15, yPosition - 4, 50, 6, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.text('MANAGER ESCALATION', 17, yPosition)
    pdf.setTextColor(0, 0, 0)
    yPosition += 8
  }

  // Basic info section
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Call Information', 15, yPosition)
  yPosition += 6

  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')

  const basicInfo = [
    ['Agent', call.agent_full_name || 'Unknown'],
    ['Date/Time', call.started_at ? new Date(call.started_at).toLocaleString() : 'N/A'],
    ['Direction', call.direction || 'N/A'],
    ['Talk Time', formatDuration(call.talk_time)],
    ['Handle Time', formatDuration(call.handle_time)],
    ['Phone', call.contact_phone || 'N/A'],
  ]

  basicInfo.forEach(([label, value]) => {
    pdf.text(`${label}:`, 15, yPosition)
    pdf.text(value, 60, yPosition)
    yPosition += 5
  })

  yPosition += 5

  // QA Scores section
  if (call.qa) {
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Quality Scores', 15, yPosition)
    yPosition += 6

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')

    const scores = [
      ['Overall Score', call.qa.overall_score || 'N/A'],
      ['Compliance', call.qa.compliance_rating || 'N/A'],
      ['Customer Satisfaction', call.qa.customer_satisfaction_likely || 'N/A'],
    ]

    scores.forEach(([label, value]) => {
      pdf.text(`${label}:`, 15, yPosition)
      pdf.text(value, 60, yPosition)
      yPosition += 5
    })

    yPosition += 5
  }

  // Call summary
  if (call.qa?.call_summary) {
    checkPageBreak()
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Call Summary', 15, yPosition)
    yPosition += 6

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    const summaryLines = pdf.splitTextToSize(call.qa.call_summary, pageWidth - 30)
    summaryLines.forEach((line: string) => {
      checkPageBreak()
      pdf.text(line, 15, yPosition)
      yPosition += 5
    })
    yPosition += 5
  }

  // Compliance violations
  if (qaData?.compliance_scorecard?.compliance_violations?.length > 0) {
    checkPageBreak()
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(220, 38, 38)
    pdf.text('Compliance Violations', 15, yPosition)
    pdf.setTextColor(0, 0, 0)
    yPosition += 6

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')

    qaData.compliance_scorecard.compliance_violations.forEach((violation: string) => {
      checkPageBreak()
      const violationLines = pdf.splitTextToSize(`• ${violation}`, pageWidth - 30)
      violationLines.forEach((line: string) => {
        pdf.text(line, 15, yPosition)
        yPosition += 5
      })
    })
    yPosition += 5
  }

  // Coaching recommendations
  if (qaData?.coaching_recommendations?.areas_for_improvement?.length > 0) {
    checkPageBreak()
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Areas for Improvement', 15, yPosition)
    yPosition += 6

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')

    qaData.coaching_recommendations.areas_for_improvement.forEach((area: string) => {
      checkPageBreak()
      const areaLines = pdf.splitTextToSize(`• ${area}`, pageWidth - 30)
      areaLines.forEach((line: string) => {
        pdf.text(line, 15, yPosition)
        yPosition += 5
      })
    })
    yPosition += 5
  }

  // Strengths
  if (qaData?.coaching_recommendations?.strengths?.length > 0) {
    checkPageBreak()
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Strengths', 15, yPosition)
    yPosition += 6

    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')

    qaData.coaching_recommendations.strengths.forEach((strength: string) => {
      checkPageBreak()
      const strengthLines = pdf.splitTextToSize(`• ${strength}`, pageWidth - 30)
      strengthLines.forEach((line: string) => {
        pdf.text(line, 15, yPosition)
        yPosition += 5
      })
    })
  }

  // Footer
  pdf.setFontSize(8)
  pdf.setTextColor(100, 100, 100)
  const totalPages = pdf.internal.pages.length - 1
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i)
    pdf.text(
      `Page ${i} of ${totalPages} | Generated on ${new Date().toLocaleString()}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    )
  }

  // Save PDF
  const fileName = `call-detail-${call.call_id}-${new Date().toISOString().split('T')[0]}.pdf`
  pdf.save(fileName)
}

// Helper function
function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
