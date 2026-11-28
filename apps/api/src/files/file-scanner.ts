export const FILE_SCANNER = Symbol("FILE_SCANNER");

export type ScanVerdict = { clean: true } | { clean: false; reason: string };

/** Checks an uploaded file before anyone can open it. */
export interface FileScanner {
  scan(bytes: Buffer, declaredMime: string): Promise<ScanVerdict>;
}

const SIGNATURES: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Development checker: the content must match the declared type, the EICAR test string is
 * rejected, and PDFs with embedded scripts or launch actions are rejected. This is NOT a
 * malware scanner; production requires a real one (refused in production by config).
 */
export class BasicFileScanner implements FileScanner {
  async scan(bytes: Buffer, declaredMime: string): Promise<ScanVerdict> {
    const signature = SIGNATURES[declaredMime];
    if (!signature) return { clean: false, reason: "File type is not accepted" };
    if (bytes.length < signature.length || !signature.every((byte, i) => bytes[i] === byte)) {
      return { clean: false, reason: "File content does not match its declared type" };
    }
    const text = bytes.toString("latin1");
    if (text.includes(EICAR)) return { clean: false, reason: "File failed the security check" };
    if (
      declaredMime === "application/pdf" &&
      /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(text)
    ) {
      return { clean: false, reason: "PDFs with scripts or embedded files are not accepted" };
    }
    return { clean: true };
  }
}

/**
 * No scanner available (production until a real malware scanner is approved): document uploads
 * are refused before any bytes are accepted, and anything that still reaches a check is
 * rejected, so no unscanned document can ever be opened.
 */
export class DisabledFileScanner implements FileScanner {
  async scan(): Promise<ScanVerdict> {
    return { clean: false, reason: "Document checks are not available yet" };
  }
}
