import React, { useState, useEffect } from 'react';
import { computeFingerprint } from '../../utils/e2ee';

export default function SafetyNumberModal({ user, contactUser, onClose }) {
  const [myFingerprint, setMyFingerprint] = useState('Đang tính toán...');
  const [contactFingerprint, setContactFingerprint] = useState('Đang tính toán...');
  const [isVerified, setIsVerified] = useState(false);

  const storageKey = `verified_sn_${user._id}_${contactUser._id}`;

  useEffect(() => {
    const checkVerification = localStorage.getItem(storageKey);
    if (checkVerification === 'true') {
      setIsVerified(true);
    }

    const calcFingerprints = async () => {
      // 1. My device fingerprint
      if (user.devices && user.devices.length > 0) {
        const fp = await computeFingerprint(user.devices[0].publicKey);
        setMyFingerprint(fp);
      } else {
        setMyFingerprint('Chưa đăng ký thiết bị');
      }

      // 2. Contact device fingerprint
      if (contactUser.devices && contactUser.devices.length > 0) {
        const fp = await computeFingerprint(contactUser.devices[0].publicKey);
        setContactFingerprint(fp);
      } else {
        setContactFingerprint('Chưa đăng ký thiết bị');
      }
    };

    calcFingerprints();
  }, [user, contactUser, storageKey]);

  const toggleVerify = () => {
    const nextState = !isVerified;
    setIsVerified(nextState);
    localStorage.setItem(storageKey, nextState ? 'true' : 'false');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="card w-full max-w-md bg-white text-black border border-gray-200 relative overflow-hidden shadow-2xl rounded-2xl p-6 flex flex-col gap-4 font-sans animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
            🔐 Mã An Toàn (Safety Number)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-gray-100 text-gray-500 hover:text-black text-xs cursor-pointer bg-gray-50 px-2.5 py-1 rounded-full font-semibold"
          >
            ✕
          </button>
        </div>

        <div className="text-xs text-gray-600 space-y-3">
          <p>
            So sánh mã an toàn này với đối phương qua kênh liên lạc trực tiếp (quét mã / điện thoại) để đảm bảo không ai can thiệp vào cuộc trò chuyện.
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Mã của bạn ({user.nickname || user.username})</span>
            <p className="font-mono text-xs font-bold text-gray-800 break-all leading-relaxed bg-white border border-gray-200 p-2 rounded-lg text-center select-all">
              {myFingerprint}
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Mã của {contactUser.nickname || contactUser.username}</span>
            <p className="font-mono text-xs font-bold text-gray-800 break-all leading-relaxed bg-white border border-gray-200 p-2 rounded-lg text-center select-all">
              {contactFingerprint}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-2">
          <button
            type="button"
            onClick={toggleVerify}
            className={`px-4 py-2 text-xs font-bold rounded-full cursor-pointer transition-all ${
              isVerified
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-xs'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {isVerified ? '✓ Đã xác minh an toàn' : 'Đánh dấu đã xác minh'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-black bg-gray-100 hover:bg-gray-200 rounded-full cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
