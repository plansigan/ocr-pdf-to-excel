import React, { useState } from "react";
import Tesseract from "tesseract.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { parseReceipt } from "../utils/helper";

GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

const OCRComponent = () => {
  // Array of receipt objects (each returned from parseReceipt)
  const [ocrText, setOcrText] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [workbook, setWorkbook] = useState(null);

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

  const handleFileChange = async (event) => {
    setIsLoading(true);
    setProgress(0);
    const files = event.target.files;
    setOcrText([]);

    if (files.length === 0) {
      setIsLoading(false);
      return;
    }

    let totalPages = 0;
    const pdfFiles = [];
    let globalCompletedPages = 0;

    // Count both PDF pages and image files as "pages" for progress
    totalPages = Array.from(files).reduce((acc, file) => {
      return acc + (file.type === "application/pdf" ? 0 : 1); // Start with image count
    }, 0);

    // Process PDFs to count their pages
    for (const file of files) {
      if (file.type === "application/pdf") {
        const pdf = await getDocument(URL.createObjectURL(file)).promise;
        totalPages += pdf.numPages;
        pdfFiles.push({ file, pdf });
      }
    }

    // Process non-PDF files first
    for (const file of files) {
      if (file.type !== "application/pdf") {
        await Tesseract.recognize(file, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              const pageProgress = globalCompletedPages + m.progress;
              setProgress(Math.round((pageProgress / totalPages) * 100));
            }
          },
        }).then(({ data: { text } }) => {
          setOcrText((prevList) => [...prevList, parseReceipt(text)]);
          globalCompletedPages++;
          setProgress(Math.round((globalCompletedPages / totalPages) * 100));
        });
      }
    }

    // Process PDF files
    for (const { pdf } of pdfFiles) {
      let allText = "";
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;

        const text = await Tesseract.recognize(canvas, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              const pageProgress = globalCompletedPages + m.progress;
              setProgress(Math.round((pageProgress / totalPages) * 100));
            }
          },
        }).then(({ data: { text } }) => text);

        allText += text + "\n\n";
        globalCompletedPages++;
        setProgress(Math.round((globalCompletedPages / totalPages) * 100));
      }
      setOcrText((prevList) => [...prevList, parseReceipt(allText)]);
    }
    setIsLoading(false);
    setProgress(100);
  };

  // Handle Excel file upload
  const handleExcelFileChange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(arrayBuffer);
      setWorkbook(wb);
    }
  };

  const populateExcel = async () => {
    if (!workbook) {
      alert("Please upload an Excel file first.");
      return;
    }

    if (ocrText.length === 0) {
      alert("Please upload at least one PDF file first");
      return;
    }
    const worksheet = workbook.worksheets[0] || workbook.addWorksheet("Sheet1");

    const formulaColumns = new Set([6, 7, 10, 36, 37, 45, 46]);

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 3 && rowNumber <= 48) {
        row.eachCell((cell, colNumber) => {
          if (!formulaColumns.has(colNumber)) {
            cell.value = null;
          }
        });
      } else if (rowNumber >= 50) {
        // Clear entire rows for 50+
        row.eachCell((cell) => {
          cell.value = null;
          cell.formula = undefined;
        });
      }
    });

    // Populate new data starting from row 3
    let rowIndex = 3;
    ocrText
      .sort((a, b) => new Date(b.dateIssued) - new Date(a.dateIssued))
      .forEach((receiptObj) => {
        if (rowIndex === 49) rowIndex++; // Skip row 49

        const row = worksheet.getRow(rowIndex);
        headers.forEach((header, colIndex) => {
          const colNumber = colIndex + 1; // Convert to 1-based index
          // Skip formula columns in all rows
          if (formulaColumns.has(colNumber)) return;

          const mappedKey = headerMapping[header];
          const rawValue = receiptObj[mappedKey];
          let finalValue = "";

          if (rawValue) {
            if (dateKeys.has(mappedKey)) {
              finalValue = formatDateValue(rawValue);
            } else if (
              typeof rawValue === "string" &&
              rawValue.match(/[\d,]+\.\d+/)
            ) {
              finalValue = parseFloat(rawValue.replace(/,/g, ""));
            } else {
              finalValue = rawValue;
            }
          }
          row.getCell(colNumber).value = finalValue;
        });
        row.commit();
        rowIndex++;
      });

    // Save updated workbook
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
`;

// Inject styles
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

export default OCRComponent;
