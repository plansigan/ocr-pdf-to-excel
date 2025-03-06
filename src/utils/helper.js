import { branchMap } from "./const";

function toCamelCase(str) {
  return (
    str
      // Replace any non-alphanumeric character (except space) with a space
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      // Split string into words by spaces
      .split(" ")
      // Remove any empty strings resulting from multiple spaces
      .filter((word) => word.length > 0)
      // Convert words to camelCase
      .map((word, index) => {
        word = word.toLowerCase();
        return index === 0
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join("")
  );
}

export function parseReceipt(text) {
  const data = {};
  const lines = text.split("\n");

  //getting the sheet
  const regexBranch = /\b(SM CITY CLARK|SM CITY PAMPANGA)\b/;
  const branch = lines[3].trim().match(regexBranch);
  const sheet = branchMap[branch[0]];

  data.sheet = sheet

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (trimmedLine) {
    }
    if (trimmedLine.includes(":")) {
      // Split the line into key and value parts using the first occurrence of ":"
      const [key, ...valueParts] = trimmedLine.split(":");
      const value = valueParts.join(":").trim();
      // Use the camelCased key in the object
      data[toCamelCase(key.trim())] = value;
    }
  });

  return data;
}
