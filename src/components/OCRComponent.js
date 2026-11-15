import React, { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { parseReceipt } from "../utils/helper";
import { branchList } from "../utils/const";

GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

const runWithBackgroundLock = (fn) => {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("ocr-conversion-lock", fn);
  }
  return fn();
};

const OCRComponent = () => {
  // Array of receipt objects (each returned from parseReceipt)
  const [ocrText, setOcrText] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const activeWorkerRef = useRef(null);

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    return () => {
      styleSheet.remove();
      if (activeWorkerRef.current) {
        activeWorkerRef.current.terminate();
        activeWorkerRef.current = null;
      }
    };
  }, []);

  // Column headers (residing in row 2)
  const headers = [
    "DATE",
    "SHIFT",
    "CASHIER(FULLNAME/NICKNAME)",
    "DECLARED CASH",
    "CALCULATED CASH (SALES INVOICE)",
    "NET OF SPECIAL SALES",
    "CASH OVER/SHORT - VARIANCE DECLARED VS CALCULATED",
    "DATE OF TRANSACTION",
    "CASH DEPOSIT",
    "VARIANCE DECLARED VS DEPOSITED",
    "OTHER DEPOSITS(MANUAL SALES)",
    "CREDIT CARD SALES",
    "CREDIT CARD CHARGE",
    "CR MEMO",
    "G.C.",
    "PAYMAYA",
    "VIP SOLD",
    "VIP",
    "CENTURY SHOPAHOLIC VOUCHERS",
    "GCASH",
    "FOOD PANDA A/R",
    "HONESTBEE",
    "METRODEAL(NET SALE)",
    "MARKETING A/R",
    "OTHER A/R",
    "LAZADA",
    "SHOPEE",
    "GRAB",
    "BOOKY",
    "POODTRIP",
    "PICK.A.ROO",
    "PARAHERO",
    "RARE FOOD SHOP",
    "SHOPEEPAY",
    "METROMART",
    "TOTAL NON-CASH",
    "TOTAL PAYMENTS",
    "BULK / WHOLESALE/IN HOUSE",
    "OTHERS (Please Specify)",
    "CATERING",
    "OFFSITE SELLING",
    "SNACKSHOP",
    "DELIVERY FEE",
    "CART SALES",
    "TOTAL SPECIAL SALES",
    "OVERALL SALES",
    "SR. CITIZEN DISC",
    "PWD DISC",
    "OTHER DISC",
    "TRANSACTION COUNT (POS)",
    "GC ORIGINATING STORE",
    "GC SERIAL NUMBER",
    "TERMINALID",
    "VOIDS",
  ];

  // Mapping of header names to keys in your OCR objects.
  const headerMapping = {
    DATE: "for", // For example, map "DATE" to key "for"
    GRAB: "grab", // Explicitly map "GRAB" header to "grab" key
    GCASH: "gcash",
    "PWD DISC": "pwdDiscount",
    "SR. CITIZEN DISC": "seniorDiscount",
    "OTHER DISC": "regularDiscount",
    "TRANSACTION COUNT (POS)": "noTransactions",
    VOIDS: "cancelledAmount",
    "CALCULATED CASH (SALES INVOICE)": "cashSales",
    // Add more explicit mappings here if needed.
  };

  // A set of keys that should be treated as dates.
  const dateKeys = new Set(["dateIssued", "dateOfTransaction", "for"]);

  // Helper: Format a date string into "MM/DD/YY"
  // Removes ordinal suffixes (e.g., "1st" => "1") and then formats the date.
  const formatDateValue = (value) => {
    if (typeof value === "string") {
      const cleaned = value.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
      const parsedDate = new Date(cleaned);
      if (!isNaN(parsedDate.getTime())) {
        const mm = String(parsedDate.getMonth() + 1).padStart(2, "0");
        const dd = String(parsedDate.getDate()).padStart(2, "0");
        const yy = String(parsedDate.getFullYear()).slice(-2);
        return `${mm}/${dd}/${yy}`;
      }
    }
    return value;
  };

  const processFilesInWorker = async (filePayloads) => {
    return new Promise((resolve, reject) => {
      if (activeWorkerRef.current) {
        activeWorkerRef.current.terminate();
      }

      const worker = new Worker(
        new URL("../workers/ocrWorker.js", import.meta.url)
      );
      activeWorkerRef.current = worker;

      const cleanup = () => {
        if (activeWorkerRef.current === worker) {
          activeWorkerRef.current = null;
        }
        worker.terminate();
      };

      worker.onmessage = (event) => {
        const { type, progress: workerProgress, results, message } = event.data;
        if (type === "progress") {
          setProgress(workerProgress);
        } else if (type === "complete") {
          cleanup();
          resolve(results);
        } else if (type === "error") {
          cleanup();
          reject(new Error(message || "Worker OCR processing failed."));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        reject(new Error(err?.message || "OCR worker encountered an error."));
      };

      const transferables = filePayloads.map((item) => item.buffer);
      worker.postMessage({ files: filePayloads }, transferables);
    });
  };

  const processFilesOnMainThread = async (filePayloads) => {
    let totalPages = 0;
    const pdfDocs = [];
    const imagePayloads = [];

    for (const fileData of filePayloads) {
      if (fileData.type === "application/pdf") {
        const pdf = await getDocument({ data: new Uint8Array(fileData.buffer) })
          .promise;
        totalPages += pdf.numPages;
        pdfDocs.push(pdf);
      } else {
        totalPages += 1;
        imagePayloads.push(fileData);
      }
    }

    if (totalPages === 0) return [];

    let completedPages = 0;
    const reportProgress = (fraction = 0) => {
      setProgress(
        Math.min(100, Math.round(((completedPages + fraction) / totalPages) * 100))
      );
    };

    const worker = await createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          reportProgress(m.progress);
        }
      },
    });

    const results = [];
    try {
      for (const fileData of imagePayloads) {
        const blob = new Blob([fileData.buffer], {
          type: fileData.type || "image/png",
        });
        const {
          data: { text },
        } = await worker.recognize(blob);
        results.push(parseReceipt(text));
        completedPages += 1;
        reportProgress(0);
      }

      for (const pdf of pdfDocs) {
        let allText = "";
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport }).promise;
          const {
            data: { text },
          } = await worker.recognize(canvas);
          allText += text + "\n\n";
          completedPages += 1;
          reportProgress(0);
        }
        results.push(parseReceipt(allText));
      }
    } finally {
      await worker.terminate().catch(() => {});
      for (const pdf of pdfDocs) {
        await pdf.destroy().catch(() => {});
      }
    }

    return results;
  };

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files || []);
    setError(null);
    setOcrText([]);

    if (files.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setProgress(0);

    try {
      const filePayloads = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          buffer: await file.arrayBuffer(),
        }))
      );

      const canUseWorker =
        typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

      const results = await runWithBackgroundLock(() =>
        canUseWorker
          ? processFilesInWorker(filePayloads)
          : processFilesOnMainThread(filePayloads)
      );

      setOcrText(results);
      setProgress(100);
    } catch (err) {
      console.error("OCR processing failed:", err);
      setError(err?.message || "Failed to process uploaded files.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Excel file upload
  const handleExcelFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(arrayBuffer);
      setWorkbook(wb);
    } catch (err) {
      console.error("Failed to load Excel template:", err);
      setError("Failed to load the Excel template. Please check the file.");
    }
  };

  const populateExcel = async () => {
    if (!workbook) {
      alert("Please upload an Excel file first.");
      return;
    }

    if (ocrText.length === 0) {
      alert("Please upload at least one PDF or image file first.");
      return;
    }

    // Columns to preserve (formula columns)
    const formulaColumns = new Set([6, 7, 10, 36, 37, 45, 46]);

    // Clear existing data from each branch sheet
    branchList.forEach((branch) => {
      const branchSheet = workbook.worksheets.find(
        (sheet) => sheet.name === branch
      );
      if (!branchSheet) return;

      branchSheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 3 && rowNumber <= 48) {
          row.eachCell((cell, colNumber) => {
            if (!formulaColumns.has(colNumber)) {
              cell.value = null;
            }
          });
        }
      });
    });

    // Sort and group receipts by sheet without mutating state
    const sortedReceipts = [...ocrText].sort((a, b) => {
      const timeA = a.dateIssued ? new Date(a.dateIssued).getTime() : 0;
      const timeB = b.dateIssued ? new Date(b.dateIssued).getTime() : 0;
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });
    const groupedBySheet = sortedReceipts.reduce((acc, receipt) => {
      const sheet = receipt.sheet;
      if (!sheet) return acc;
      if (!acc[sheet]) acc[sheet] = [];
      acc[sheet].push(receipt);
      return acc;
    }, {});

    // Populate data per sheet
    branchList.forEach((branch) => {
      const worksheet = workbook.worksheets.find(
        (sheet) => sheet.name === branch
      );
      if (!worksheet) {
        console.warn(`Sheet ${branch} not found. Skipping.`);
        return;
      }

      const receipts = groupedBySheet[branch] || [];
      let currentRow = 3;

      receipts.forEach((receipt) => {
        if (currentRow === 49) currentRow++;

        const row = worksheet.getRow(currentRow);
        headers.forEach((header, colIndex) => {
          const colNumber = colIndex + 1;
          if (formulaColumns.has(colNumber)) return;

          const mappedKey = headerMapping[header];
          const rawValue = receipt[mappedKey];
          let finalValue = "";
          let isExplicitZero = false; // Flag to track explicit zeros

          if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
            if (dateKeys.has(mappedKey)) {
              finalValue = formatDateValue(rawValue);
            } else {
              const numericValue = parseFloat(String(rawValue).replace(/,/g, ""));
              finalValue = isNaN(numericValue) ? 0 : numericValue;
              isExplicitZero = numericValue === 0; // Mark explicit zero
            }
          } else {
            finalValue = dateKeys.has(mappedKey) ? "" : 0;
          }

          const cell = row.getCell(colNumber);
          cell.value = finalValue;

          // Hide zeros for numeric columns
          if (
            !dateKeys.has(mappedKey) &&
            finalValue === 0 &&
            !isExplicitZero
          ) {
            cell.numFmt = "0;-0;;@"; // Custom format to hide zero
          }
        });

        row.commit();
        currentRow++;
      });
    });

    // Save the updated workbook
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, "populated_excel.xlsx");
  };

  return (
    <div className="ocr-container">
      <div className="upload-section">
        <h2>Upload Receipts (PDF/Images)</h2>
        <label className="file-upload">
          <input
            type="file"
            onChange={handleFileChange}
            accept="image/*,application/pdf"
            multiple
            disabled={isLoading}
          />
          <span className="upload-button">Choose Files</span>
        </label>
      </div>

      <div className="upload-section">
        <h2>Upload Excel Template</h2>
        <label className="file-upload">
          <input
            type="file"
            onChange={handleExcelFileChange}
            accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
          <span className="upload-button">Choose File</span>
        </label>
      </div>

      {isLoading && (
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          <div className="progress-text">{progress}%</div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {!isLoading && ocrText.length > 0 && (
        <div className="status-message">
          Processed {ocrText.length} receipt(s).
        </div>
      )}

      <button
        className="populate-button"
        onClick={populateExcel}
        disabled={isLoading}
      >
        Generate Report
      </button>
    </div>
  );
};

const styles = `
.ocr-container {
  max-width: 800px;
  margin: 2rem auto;
  padding: 2rem;
  background: #f8f9fa;
  border-radius: 10px;
  box-shadow: 0 2px 15px rgba(0,0,0,0.1);
}

.upload-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 5px rgba(0,0,0,0.05);
}

h2 {
  color: #2c3e50;
  margin-bottom: 1rem;
  font-size: 1.2rem;
}

.file-upload {
  display: flex;
  position: relative;
  cursor: pointer;
  align-items:center;
  justify-content:center;
}

.file-upload input[type="file"] {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.upload-button {
  display: inline-block;
  padding: 0.8rem 1.5rem;
  background: #3498db;
  color: white;
  border-radius: 5px;
  transition: background 0.3s ease;
}

.upload-button:hover {
  background: #2980b9;
}

.progress-container {
  margin: 2rem 0;
  height: 25px;
  width:300px;
  background: #e9ecef;
  border-radius: 5px;
  overflow: hidden;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: #27ae60;
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-weight: bold;
  mix-blend-mode: difference;
}

.populate-button {
  display: block;
  width: 100%;
  padding: 1rem;
  background: #2ecc71;
  color: white;
  border: none;
  border-radius: 5px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: background 0.3s ease;
}

.populate-button:hover {
  background: #27ae60;
}

.populate-button:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.error-message {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #fdecea;
  color: #b71c1c;
  border-radius: 5px;
}

.status-message {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  background: #e8f5e9;
  color: #1b5e20;
  border-radius: 5px;
}
`;

export default OCRComponent;
