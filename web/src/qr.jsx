import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// A QR code for a link, drawn in the browser (nothing is sent anywhere)
export function Qr({ value, size = 140, label = 'QR code', onReady }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size * 3, margin: 1, errorCorrectionLevel: 'M' }).then(
      (url) => live && setSrc(url),
      () => live && setSrc('')
    );
    return () => {
      live = false;
    };
  }, [value, size]);
  useEffect(() => {
    if (src && onReady) onReady();
  }, [src, onReady]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={label} /> : <span className="qr qr-empty" style={{ width: size, height: size }} />;
}

// A large PNG to save, for slides or a printed handout
export const qrPng = (value) => QRCode.toDataURL(value, { width: 1200, margin: 2, errorCorrectionLevel: 'M' });
