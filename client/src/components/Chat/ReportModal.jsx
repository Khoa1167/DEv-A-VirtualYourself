import React, { useState } from 'react';
import Modal from '../common/Modal';
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
    <Modal onClose={onClose} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
        <div className="flex items-center justify-between border-b border-base-300 pb-3 mb-4">
          <h3 className="text-base font-bold flex items-center gap-1.5">
            🚩 Báo cáo tin nhắn vi phạm
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="bg-base-200 border border-base-300 rounded-lg p-3 text-xs text-base-content/70 max-h-24 overflow-y-auto">
            <span className="font-bold text-base-content">Tin nhắn bị báo cáo: </span>
            <p className="mt-1 italic font-mono">"{message.decryptedText || message.content}"</p>
          </div>

          <div className="form-control flex flex-col gap-2">
            <label className="label-text text-xs font-bold text-base-content/60 uppercase tracking-wider">Lý do báo cáo</label>
            <select
              className="select select-bordered select-sm w-full"
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
            <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-lg">
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-sm btn-ghost rounded-full"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-sm btn-error rounded-full text-white"
            >
              {loading ? 'Đang gửi...' : 'Gửi báo cáo'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
