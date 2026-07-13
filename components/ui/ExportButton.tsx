'use client';

/**
 * ExportButton
 * Offers CSV download (via react-csv) and a PDF summary (via jspdf) from
 * any array of KPI/data objects passed in as the `data` prop.
 *
 * Usage:
 *   <ExportButton
 *     data={kpiRows}
 *     headers={[{ label: 'Vessel TAT (hrs)', key: 'avgVesselTAT' }, ...]}
 *     filename="port-kpis"
 *     title="Port ICCC KPI Report"
 *   />
 */

import React, { useRef, useState } from 'react';
import { CSVLink } from 'react-csv';
import jsPDF from 'jspdf';
import { Button } from '@/components/ui/button';
import { ChevronDown, Download, FileText } from 'lucide-react';

export interface ExportHeader {
  label: string;
  key: string;
}

interface ExportButtonProps {
  /** Array of plain objects to export. Each object should have keys matching `headers`. */
  data: Record<string, string | number | boolean | null | undefined>[];
  /** Column definitions for the CSV / PDF table. */
  headers: ExportHeader[];
  /** Base filename (without extension). Defaults to "port-export". */
  filename?: string;
  /** Title shown at the top of the PDF. Defaults to "Port Export". */
  title?: string;
  /** Optional subtitle / timestamp row shown below the title. */
  subtitle?: string;
}

export function ExportButton({
  data,
  headers,
  filename = 'port-export',
  title = 'Port Export',
  subtitle,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const csvRef = useRef<HTMLAnchorElement & { link: HTMLAnchorElement }>(null);

  function handlePDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    let y = 14;

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(title, pageW / 2, y, { align: 'center' });
    y += 7;

    // Subtitle / timestamp
    const stamp = subtitle ?? `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text(stamp, pageW / 2, y, { align: 'center' });
    doc.setTextColor(0);
    y += 8;

    // Table header
    const colW = Math.min(40, (pageW - 20) / headers.length);
    const startX = 10;

    doc.setFillColor(30, 58, 138); // Port navy
    doc.rect(startX, y, pageW - 20, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255);
    headers.forEach((h, i) => {
      doc.text(String(h.label), startX + i * colW + 2, y + 5.5, { maxWidth: colW - 3 });
    });
    doc.setTextColor(0);
    y += 10;

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    data.forEach((row, rowIdx) => {
      if (y > 185) {
        doc.addPage();
        y = 14;
      }
      if (rowIdx % 2 === 0) {
        doc.setFillColor(240, 244, 255);
        doc.rect(startX, y - 1, pageW - 20, 7, 'F');
      }
      headers.forEach((h, i) => {
        const val = row[h.key];
        doc.text(val != null ? String(val) : '—', startX + i * colW + 2, y + 4, {
          maxWidth: colW - 3,
        });
      });
      y += 7;
    });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Port Integrated Command & Control Centre — Confidential', pageW / 2, 200, { align: 'center' });

    doc.save(`${filename}.pdf`);
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5"
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-popover shadow-lg">
            {/* CSV */}
            <CSVLink
              data={data}
              headers={headers}
              filename={`${filename}.csv`}
              ref={csvRef}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => setOpen(false)}
            >
              <Download className="h-4 w-4 shrink-0" />
              Download as CSV
            </CSVLink>

            {/* PDF */}
            <button
              onClick={handlePDF}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <FileText className="h-4 w-4 shrink-0" />
              Download PDF Summary
            </button>
          </div>
        </>
      )}
    </div>
  );
}
