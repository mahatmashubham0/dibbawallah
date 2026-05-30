declare module 'qrcode' {
  export function toDataURL(
    value: string,
    options?: Record<string, unknown>,
  ): Promise<string>;
}
