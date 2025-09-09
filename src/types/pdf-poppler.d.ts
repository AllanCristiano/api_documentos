declare module 'pdf-poppler' {
  interface PopplerOptions {
    format?: 'jpeg' | 'png' | 'tiff' | 'pdf' | 'ps' | 'eps' | 'svg';
    out_dir?: string;
    out_prefix?: string;
    page?: number | null;
  }

  interface Poppler {
    convert(pdfPath: string, options?: PopplerOptions): Promise<void>;
    pdftoppmBinary: string;
  }

  const poppler: Poppler;
  export default poppler;
}
