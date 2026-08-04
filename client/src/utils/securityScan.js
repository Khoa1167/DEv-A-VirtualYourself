/**
 * Utility quét liên kết an toàn phía Client (Client-Side Pre-Scan)
 * Thực hiện Static Analysis: Homograph Attack, Punycode, Subdomain giả mạo, IP URL.
 */

// Chuyển đổi mã Unicode ký tự sang tên miền Punycode (đơn giản hóa)
const isMixedScriptDomain = (hostname) => {
  if (!hostname) return false;

  // Kiểm tra chứa ký tự Cyrillic (thường dùng trong Homograph Attack như а, е, o, p, c...)
  const hasCyrillic = /[\u0400-\u04FF]/.test(hostname);
  // Kiểm tra chứa ký tự Latin chuẩn
  const hasLatin = /[a-zA-Z]/.test(hostname);

  // Nếu chứa đồng thời cả Latin và Cyrillic trong cùng 1 domain -> Mixed Script Attack
  return hasCyrillic && hasLatin;
};

// Kiểm tra IP address làm hostname (e.g. http://192.168.1.1/login)
const isIPAddressDomain = (hostname) => {
  if (!hostname) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
};

// Kiểm tra Fake Subdomain (e.g. paypal.com.secure-login-check.xyz)
const isFakeSubdomain = (hostname) => {
  if (!hostname) return false;
  const parts = hostname.toLowerCase().split('.');
  if (parts.length >= 3) {
    const popularBrands = ['paypal', 'facebook', 'google', 'apple', 'microsoft', 'binance', 'vietcombank'];
    const firstPart = parts[0];
    const restDomain = parts.slice(1).join('.');

    // Thương hiệu xuất hiện ở subdomain nhưng domain chính không phải thương hiệu đó
    if (popularBrands.some(brand => firstPart.includes(brand)) && !restDomain.includes(firstPart)) {
      return true;
    }
  }
  return false;
};

/**
 * Quét danh sách URL có trong văn bản
 * @param {string} text 
 * @returns {object} { hasWarning: boolean, warnings: Array, urls: Array }
 */
export const scanLinksInText = (text) => {
  if (!text || typeof text !== 'string') {
    return { hasWarning: false, warnings: [], urls: [] };
  }

  // Regex trích xuất URL
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;
  const matches = text.match(urlRegex) || [];

  if (matches.length === 0) {
    return { hasWarning: false, warnings: [], urls: [] };
  }

  const warnings = [];
  const scannedUrls = [];

  for (const urlStr of matches) {
    try {
      const urlObj = new URL(urlStr);
      const hostname = urlObj.hostname;
      scannedUrls.push(urlStr);

      if (isMixedScriptDomain(hostname)) {
        warnings.push({
          url: urlStr,
          type: 'HOMOGRAPH',
          message: `Cảnh báo: Tên miền "${hostname}" sử dụng ký tự Unicode giả mạo (Homograph Attack).`
        });
      } else if (isFakeSubdomain(hostname)) {
        warnings.push({
          url: urlStr,
          type: 'FAKE_SUBDOMAIN',
          message: `Cảnh báo: Tên miền "${hostname}" có dấu hiệu giả mạo thương hiệu.`
        });
      } else if (isIPAddressDomain(hostname)) {
        warnings.push({
          url: urlStr,
          type: 'IP_ADDRESS',
          message: `Cảnh báo: Liên kết sử dụng địa chỉ IP trực tiếp (${hostname}). Hãy cẩn trọng trước khi mở.`
        });
      }
    } catch {
      // URL không hợp lệ -> bỏ qua
    }
  }

  return {
    hasWarning: warnings.length > 0,
    warnings,
    urls: scannedUrls,
  };
};
