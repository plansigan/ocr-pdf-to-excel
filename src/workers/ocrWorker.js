/* eslint-disable no-restricted-globals */
import { createWorker } from "tesseract.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import { parseReceipt } from "../utils/helper";

GlobalWorkerOptions.workerSrc = new URL(
  `${process.env.PUBLIC_URL || ""}/pdf.worker.min.mjs`,
  self.location.origin
).href;

class OffscreenCanvasFactory {
  create(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d"),
    };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

self.onmessage = async (event) => {
  const { files } = event.data;
  let tesseractWorker = null;
  const loadedPdfs = [];

  try {
    const canvasFactory = new OffscreenCanvasFactory();
    const imageFiles = [];
    let totalPages = 0;

    for (const fileData of files) {
      if (fileData.type === "application/pdf") {
        const loadingTask = getDocument({
          data: new Uint8Array(fileData.buffer),
          canvasFactory,
        });
        const pdf = await loadingTask.promise;
        totalPages += pdf.numPages;
        loadedPdfs.push(pdf);
      } else {
        totalPages += 1;
        imageFiles.push(fileData);
      }
    }

    if (totalPages === 0) {
      self.postMessage({ type: "complete", results: [] });
      return;
    }

    let completedPages = 0;
    const reportProgress = (pageFraction = 0) => {
      const pct = Math.min(
        100,
        Math.round(((completedPages + pageFraction) / totalPages) * 100)
      );
      self.postMessage({ type: "progress", progress: pct });
    };

    tesseractWorker = await createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          reportProgress(m.progress);
        }
      },
    });

    const results = [];

    for (const fileData of imageFiles) {
      const blob = new Blob([fileData.buffer], {
        type: fileData.type || "image/png",
      });
      const {
        data: { text },
      } = await tesseractWorker.recognize(blob);
      results.push(parseReceipt(text));
      completedPages += 1;
      reportProgress(0);
    }

    for (const pdf of loadedPdfs) {
      let allText = "";
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const context = canvas.getContext("2d");

        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await canvas.convertToBlob({ type: "image/png" });

        const {
          data: { text },
        } = await tesseractWorker.recognize(blob);
        allText += text + "\n\n";

        completedPages += 1;
        reportProgress(0);
      }
      results.push(parseReceipt(allText));
    }

    self.postMessage({ type: "complete", results });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error?.message || "Failed to process files.",
    });
  } finally {
    if (tesseractWorker) {
      await tesseractWorker.terminate().catch(() => {});
    }
    for (const pdf of loadedPdfs) {
      await pdf.destroy().catch(() => {});
    }
  }
};
