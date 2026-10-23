import { encryptPDF, type EncryptPDFOptions } from "@pdfsmaller/pdf-encrypt";
import { decryptPDF, isEncrypted } from "@pdfsmaller/pdf-decrypt";

export interface SecurityOptions {
  userPassword?: string;
  ownerPassword?: string;
  allowPrinting?: boolean;
  allowCopying?: boolean;
  allowModifying?: boolean;
}

/**
 * Checks whether the given PDF data is encrypted with a password.
 *
 * @param sourceData Raw Uint8Array of the PDF.
 * @returns Status object detailing whether it is encrypted.
 */
export async function checkIsEncrypted(sourceData: Uint8Array): Promise<{
  encrypted: boolean;
  algorithm?: string;
}> {
  try {
    return await isEncrypted(sourceData);
  } catch (err) {
    console.error("Failed to check PDF encryption status:", err);
    return { encrypted: false };
  }
}

/**
 * Protects a PDF document by applying AES-256 password encryption.
 *
 * @param sourceData Raw Uint8Array of the source PDF.
 * @param password The password required to open/view the PDF.
 * @param options Additional permissions and optional owner password.
 * @returns Encrypted PDF as a Uint8Array.
 */
export async function protectPdf(
  sourceData: Uint8Array,
  password: string,
  options?: SecurityOptions
): Promise<Uint8Array> {
  if (!password || password.trim().length === 0) {
    throw new Error("Password cannot be empty.");
  }

  const encryptOptions: EncryptPDFOptions = {
    algorithm: "AES-256",
    ownerPassword: options?.ownerPassword || password,
    allowPrinting: options?.allowPrinting ?? true,
    allowCopying: options?.allowCopying ?? true,
    allowModifying: options?.allowModifying ?? false,
  };

  return await encryptPDF(sourceData, password, encryptOptions);
}

/**
 * Removes password protection and decryption locks from a PDF document.
 *
 * @param sourceData Raw Uint8Array of the encrypted PDF.
 * @param password The valid user or owner password for the document.
 * @returns Decrypted, unprotected PDF as a Uint8Array.
 */
export async function removePassword(
  sourceData: Uint8Array,
  password: string
): Promise<Uint8Array> {
  if (!password) {
    throw new Error("Password is required to decrypt this document.");
  }

  return await decryptPDF(sourceData, password);
}
