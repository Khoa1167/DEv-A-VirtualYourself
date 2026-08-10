import React, { useState } from 'react';
import { getDeviceId, getPrivateKey, getPublicKey, exportPrivateKeyEncrypted, importPrivateKeyFromBackup, exportPublicKeyFromPrivateKey, storePrivateKey, storePublicKey } from '../../utils/e2ee';

export default function KeyBackupModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('backup'); // 'backup' hoặc 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [backupString, setBackupString] = useState('');
  const [importedBackup, setImportedBackup] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const getPassphraseStrength = (pw) => {
    if (!pw) return { text: '', score: 0 };
    if (pw.length < 12) return { text: 'Quá ngắn (Cần tối thiểu 12 ký tự)', score: 1 };
    const hasUpper = /[A-Z]/.test(pw);
    const hasLower = /[a-z]/.test(pw);
    const hasNumber = /[0-9]/.test(pw);
    const hasSpecial = /[^A-Za-z0-9]/.test(pw);

    const matches = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
    if (matches >= 3) return { text: 'Mật khẩu mạnh ✓', score: 3 };
    return { text: 'Mật khẩu trung bình (Khuyên dùng kết hợp chữ hoa/thường/số)', score: 2 };
  };

  const strength = getPassphraseStrength(passphrase);

  const handleExportBackup = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (passphrase.length < 12) {
      setMessage({ type: 'error', text: 'Passphrase bảo vệ tệp sao lưu phải có ít nhất 12 ký tự.' });
      return;
    }

    setLoading(true);
    try {
      const deviceId = getDeviceId();
      const privateKey = await getPrivateKey(deviceId);
      if (!privateKey) {
        throw new Error('Không tìm thấy Private Key trên thiết bị này.');
      }

      const publicKeyJWK = await getPublicKey(deviceId);
      const encryptedBackup = await exportPrivateKeyEncrypted(privateKey, publicKeyJWK, passphrase);
      setBackupString(encryptedBackup);
      setMessage({ type: 'success', text: 'Tạo bản sao lưu mã hóa thành công!' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Tạo bản sao lưu thất bại.' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportBackup = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (!importedBackup.trim() || !passphrase) {
      setMessage({ type: 'error', text: 'Vui lòng nhập chuỗi sao lưu và passphrase giải mã.' });
      return;
    }

    setLoading(true);
    try {
      const deviceId = getDeviceId();
      const { privateKey, publicKey } = await importPrivateKeyFromBackup(importedBackup.trim(), passphrase);
      await storePrivateKey(deviceId, privateKey);
      let publicKeyToStore = publicKey;
      if (!publicKeyToStore) {
        try {
          publicKeyToStore = await exportPublicKeyFromPrivateKey(privateKey);
        } catch (warnErr) {
          console.warn('[E2EE] Không thể lấy public key từ private key sau khi khôi phục backup:', warnErr);
        }
      }
      if (publicKeyToStore) {
        await storePublicKey(deviceId, publicKeyToStore);
      }
      setMessage({ type: 'success', text: 'Khôi phục khóa Private Key thành công!' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Giải mã tệp sao lưu thất bại.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="card w-full max-w-md bg-white text-black border border-gray-200 relative overflow-hidden shadow-2xl rounded-2xl p-6 flex flex-col gap-4 font-sans animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
            🔑 Sao lưu & Khôi phục Khóa E2EE
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-gray-100 text-gray-500 hover:text-black text-xs cursor-pointer bg-gray-50 px-2.5 py-1 rounded-full font-semibold"
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => { setActiveTab('backup'); setMessage({ type: '', text: '' }); }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
              activeTab === 'backup' ? 'bg-white text-black shadow-2xs' : 'text-gray-500 hover:text-black'
            }`}
          >
            Export Backup
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('restore'); setMessage({ type: '', text: '' }); }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
              activeTab === 'restore' ? 'bg-white text-black shadow-2xs' : 'text-gray-500 hover:text-black'
            }`}
          >
            Restore Backup
          </button>
        </div>

        {message.text && (
          <div className={`p-3 rounded-xl text-xs font-semibold ${
            message.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'
          }`}>
            {message.text}
          </div>
        )}

        {activeTab === 'backup' ? (
          <form onSubmit={handleExportBackup} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-600">Passphrase bảo vệ (Tối thiểu 12 ký tự)</label>
              <input
                type="password"
                className="bg-white border border-gray-200 text-sm rounded-lg p-2.5 outline-none focus:border-[#0084ff]"
                placeholder="Nhập mật khẩu passphrase mạnh..."
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
              />
              {strength.text && (
                <span className={`text-[10px] font-bold ${
                  strength.score === 3 ? 'text-green-600' : strength.score === 2 ? 'text-yellow-600' : 'text-red-500'
                }`}>
                  {strength.text}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || passphrase.length < 12}
              className="bg-[#0084ff] hover:bg-[#006aff] text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer disabled:opacity-50 transition-colors"
            >
              {loading ? 'Đang tạo bản mã...' : 'Tạo bản sao lưu'}
            </button>

            {backupString && (
              <div className="flex flex-col gap-1 mt-2">
                <label className="text-[11px] font-bold text-gray-500">Chuỗi sao lưu (Hãy lưu vào nơi an toàn):</label>
                <textarea
                  readOnly
                  rows={4}
                  className="bg-gray-50 border border-gray-200 font-mono text-[10px] p-2 rounded-lg text-gray-700 select-all outline-none"
                  value={backupString}
                />
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={handleImportBackup} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-600">Dán chuỗi sao lưu (Backup String)</label>
              <textarea
                rows={3}
                className="bg-white border border-gray-200 text-xs font-mono rounded-lg p-2.5 outline-none focus:border-[#0084ff]"
                placeholder="Dán chuỗi backup base64 vào đây..."
                value={importedBackup}
                onChange={e => setImportedBackup(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-600">Passphrase giải mã</label>
              <input
                type="password"
                className="bg-white border border-gray-200 text-sm rounded-lg p-2.5 outline-none focus:border-[#0084ff]"
                placeholder="Nhập passphrase đã cài đặt khi backup..."
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !importedBackup.trim() || !passphrase}
              className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer disabled:opacity-50 transition-colors"
            >
              {loading ? 'Đang giải mã...' : 'Khôi phục khóa'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
