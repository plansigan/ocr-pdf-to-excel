import React, { createContext, useContext, useState } from 'react';

const OCRContext = createContext();

export function useOCR() {
  return useContext(OCRContext);
}

export const OCRProvider = ({ children }) => {
  const [ocrResult, setOcrResult] = useState('');

  const value = {
    ocrResult,
    setOcrResult,
  };

  return <OCRContext.Provider value={value}>{children}</OCRContext.Provider>;
};
