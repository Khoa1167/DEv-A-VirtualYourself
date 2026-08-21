const logger = require('../config/logger');

// Danh sách từ khóa độc hại/nhạy cảm phổ biến trong tiếng Việt để làm tập dữ liệu local
const TOXIC_KEYWORDS = [
  'địt', 'đéo', 'đm', 'vcl', 'clm', 'cl', 'đcm', 'cmn', 'chó đẻ', 'bú cu', 
  'luồn cú', 'ngu lồn', 'ngu lờ', 'mẹ mày', 'bố mày', 'óc chó', 'thằng điên', 
  'đồ khốn', 'vú', 'đĩ', 'phò', 'đâm chết', 'chém chết', 'giết mày', 'chết đi'
];

/**
 * Phân tích độ độc hại bằng thuật toán Local NLP (Dành cho chế độ Offline/Demo)
 * @param {string} text - Văn bản cần lọc
 * @returns {object} { isToxic: boolean, score: number, reason: string }
 */
const analyzeLocally = (text) => {
  const normalized = text.toLowerCase().trim();
  let score = 0.0;
  const flaggedWords = [];

  // 1. Kiểm tra từ khóa tục tĩu/độc hại
  TOXIC_KEYWORDS.forEach(keyword => {
    if (normalized.includes(keyword)) {
      score += 0.35; // Mỗi từ khóa vi phạm tăng điểm độc hại
      flaggedWords.push(keyword);
    }
  });

  // 2. Kiểm tra tỷ lệ chữ IN HOA (Biểu thị sự giận dữ/chửi bới)
  const letters = text.replace(/[^a-zA-Z]/g, '');
  const uppercaseLetters = text.replace(/[^A-Z]/g, '');
  if (letters.length > 5 && (uppercaseLetters.length / letters.length) > 0.7) {
    score += 0.2; // Tăng điểm nếu viết hoa quá nhiều (>70%)
  }

  // 3. Kiểm tra các ký tự chấm than liên tục (Gây áp lực/tấn công)
  if (/!{3,}/.test(text)) {
    score += 0.15;
  }

  // Giới hạn điểm số từ 0.0 đến 1.0
  score = Math.min(score, 1.0);
  const isToxic = score >= 0.6; // Ngưỡng độc hại là 0.6

  let reason = 'Nội dung lành mạnh';
  if (isToxic) {
    if (flaggedWords.length > 0) {
      reason = `Phát hiện từ khóa không phù hợp: [${flaggedWords.join(', ')}] (Độ độc hại ước tính: ${(score * 100).toFixed(0)}%)`;
    } else {
      reason = `Văn bản có hành vi giận dữ/tấn công bằng chữ viết hoa/ký tự đặc biệt (Độ độc hại ước tính: ${(score * 100).toFixed(0)}%)`;
    }
  }

  return {
    isToxic,
    score,
    reason
  };
};

/**
 * Phân tích độ độc hại bằng OpenAI Moderation API (Nếu cấu hình OPENAI_API_KEY)
 * @param {string} text - Văn bản cần lọc
 * @returns {Promise<object>} { isToxic: boolean, score: number, reason: string }
 */
const analyzeViaOpenAI = async (text, apiKey) => {
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ input: text })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const result = data.results[0];
    const isToxic = result.flagged;
    
    // Lấy điểm số cao nhất của các danh mục độc hại
    const scores = result.category_scores;
    const maxScore = Math.max(...Object.values(scores));
    
    const flaggedCategories = Object.keys(result.categories).filter(cat => result.categories[cat]);
    const reason = isToxic 
      ? `AI phát hiện nội dung vi phạm tiêu chuẩn: [${flaggedCategories.join(', ')}] (Độ tin cậy: ${(maxScore * 100).toFixed(0)}%)`
      : 'Nội dung lành mạnh';

    return {
      isToxic,
      score: maxScore,
      reason
    };
  } catch (err) {
    logger.error({ err }, '⚠️ [AI Moderation] OpenAI API call failed, falling back to local analysis');
    return analyzeLocally(text);
  }
};

/**
 * Hàm kiểm duyệt tin nhắn chính của hệ thống
 * @param {string} text - Nội dung tin nhắn rõ cần lọc
 * @returns {Promise<object>} { isToxic: boolean, score: number, reason: string }
 */
const moderateContent = async (text) => {
  if (!text || typeof text !== 'string') {
    return { isToxic: false, score: 0, reason: 'Nội dung trống' };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey !== 'your_optional_openai_api_key_here') {
    logger.debug('[AI Moderation] Analyzing message using OpenAI Moderation API...');
    return await analyzeViaOpenAI(text, apiKey);
  } else {
    return analyzeLocally(text);
  }
};

module.exports = {
  moderateContent
};
