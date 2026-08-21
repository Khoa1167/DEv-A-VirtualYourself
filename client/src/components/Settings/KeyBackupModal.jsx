import { useState } from 'react';
import Modal from '../common/Modal';
import Toast from '../common/Toast';
import PasswordInput from '../common/PasswordInput';
import useTimedMessage from '../../hooks/useTimedMessage';
import { getDeviceId, getPrivateKey, getPublicKey, exportPrivateKeyEncrypted, importPrivateKeyFromBackup, exportPublicKeyFromPrivateKey, storePrivateKey, storePublicKey } from '../../utils/e2ee';

export default function KeyBackupModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('backup'); // 'backup' hoặc 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [backupString, setBackupString] = useState('');
  const [importedBackup, setImportedBackup] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, showError] = useTimedMessage();
  const [success, showSuccess] = useTimedMessage();

  const clearMessages = () => { showError(''); showSuccess(''); };

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
    clearMessages();

    if (passphrase.length < 12) {
      showError('Passphrase bảo vệ tệp sao lưu phải có ít nhất 12 ký tự.');
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
      showSuccess('Tạo bản sao lưu mã hóa thành công!');
    } catch (err) {
      showError(err.message || 'Tạo bản sao lưu thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportBackup = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!importedBackup.trim() || !passphrase) {
      showError('Vui lòng nhập chuỗi sao lưu và passphrase giải mã.');
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
      showSuccess('Khôi phục khóa Private Key thành công!');
    } catch (err) {
      showError(err.message || 'Giải mã tệp sao lưu thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} boxClassName="max-w-md bg-base-100 border border-base-300 shadow-2xl">
        <div className="flex items-center justify-between border-b border-base-300 pb-3 mb-4">
          <h3 className="text-base font-bold flex items-center gap-1.5">
            🔑 Sao lưu & Khôi phục Khóa E2EE
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div role="tablist" className="tabs tabs-boxed mb-4">
          <button
            type="button"
            role="tab"
            onClick={() => { setActiveTab('backup'); clearMessages(); }}
            className={`tab flex-1 font-bold ${activeTab === 'backup' ? 'tab-active' : ''}`}
          >
            Sao lưu
          </button>
          <button
            type="button"
            role="tab"
            onClick={() => { setActiveTab('restore'); clearMessages(); }}
            className={`tab flex-1 font-bold ${activeTab === 'restore' ? 'tab-active' : ''}`}
          >
            Khôi phục
          </button>
        </div>

        <Toast message={error} type="error" variant="banner" alertClassName="py-2 px-3 text-xs font-semibold rounded-xl mb-4" />
        <Toast message={success} type="success" variant="banner" alertClassName="py-2 px-3 text-xs font-semibold rounded-xl mb-4" />

        {activeTab === 'backup' ? (
          <form onSubmit={handleExportBackup} className="flex flex-col gap-3">
            <div className="form-control flex flex-col gap-1">
              <label className="text-xs font-bold text-base-content/70">Passphrase bảo vệ (Tối thiểu 12 ký tự)</label>
              <PasswordInput
                className="input input-bordered input-sm w-full"
                placeholder="Nhập mật khẩu passphrase mạnh..."
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
              />
              {strength.text && (
                <span className={`text-[10px] font-bold ${
                  strength.score === 3 ? 'text-success' : strength.score === 2 ? 'text-warning' : 'text-error'
                }`}>
                  {strength.text}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || passphrase.length < 12}
              className="btn btn-primary btn-sm rounded-xl text-white"
            >
              {loading ? 'Đang tạo bản mã...' : 'Tạo bản sao lưu'}
            </button>

            {backupString && (
              <div className="flex flex-col gap-1 mt-2">
                <label className="text-[11px] font-bold text-base-content/60">Chuỗi sao lưu (Hãy lưu vào nơi an toàn):</label>
                <textarea
                  readOnly
                  rows={4}
                  className="textarea textarea-bordered bg-base-200 font-mono text-[10px] select-all"
                  value={backupString}
                />
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={handleImportBackup} className="flex flex-col gap-3">
            <div className="form-control flex flex-col gap-1">
              <label className="text-xs font-bold text-base-content/70">Dán chuỗi sao lưu (Backup String)</label>
              <textarea
                rows={3}
                className="textarea textarea-bordered text-xs font-mono"
                placeholder="Dán chuỗi backup base64 vào đây..."
                value={importedBackup}
                onChange={e => setImportedBackup(e.target.value)}
              />
            </div>

            <div className="form-control flex flex-col gap-1">
              <label className="text-xs font-bold text-base-content/70">Passphrase giải mã</label>
              <PasswordInput
                className="input input-bordered input-sm w-full"
                placeholder="Nhập passphrase đã cài đặt khi backup..."
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !importedBackup.trim() || !passphrase}
              className="btn btn-success btn-sm rounded-xl text-white"
            >
              {loading ? 'Đang giải mã...' : 'Khôi phục khóa'}
            </button>
          </form>
        )}
    </Modal>
  );
}
