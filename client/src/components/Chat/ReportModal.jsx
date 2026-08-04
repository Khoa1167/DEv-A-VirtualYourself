import React, { useState } from 'react';
import api from '../../services/api';

export default function ReportModal({ message, onClose, onSuccess }) {
  const [reason, setReason] = useState('spam');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Tính SHA-256 hash của bản mã gốc (ciphertextHash) trên Client
      let ciphertextHash = '';
      if (message.content) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message.content); // message.content ở dạng mã hóa trong DB hoặc client message object
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        ciphertextHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }

      // 2. Gửi báo cáo kèm nội dung giải mã và ciphertextHash
      const { data } = await api.post('/reports', {
        messageId: message._id,
        decryptedContent: message.decryptedText || message.content, // Nội dung đã giải mã hiển thị trên màn hình
        ciphertextHash,
        reason,
      });

      if (onSuccess) {
        onSuccess(data.message);
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Gửi báo cáo thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="card w-full max-w-sm bg-white text-black border border-gray-200 relative overflow-hidden shadow-2xl rounded-2xl p-6 flex flex-col gap-4 font-sans animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
            🚩 Báo cáo tin nhắn vi phạm
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-gray-100 text-gray-500 hover:text-black text-xs cursor-pointer bg-gray-50 px-2.5 py-1 rounded-full font-semibold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 max-h-24 overflow-y-auto">
            <span className="font-bold text-gray-800">Tin nhắn bị báo cáo: </span>
            <p className="mt-1 italic font-mono text-gray-700">"{message.decryptedText || message.content}"</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Lý do báo cáo</label>
            <select
              className="bg-white border border-gray-200 text-black text-sm rounded-lg py-2 px-3 outline-none focus:border-[#0084ff]"
              value={reason}
              onChange={e => setReason(e.target.value)}
            >
              <option value="spam">Spam / Tin nhắn rác</option>
              <option value="scam">Lừa đảo / Phishing</option>
              <option value="harassment">Quấy rối / Đe dọa</option>
              <option value="abuse">Nội dung độc hại / Độc hại</option>
              <option value="other">Khác</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-50 text-red-500 border border-red-100 py-2 px-3 text-xs font-semibold rounded-lg">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-black bg-gray-100 hover:bg-gray-200 rounded-full cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-full cursor-pointer shadow-xs disabled:opacity-50"
            >
              {loading ? 'Đang gửi...' : 'Gửi báo cáo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
