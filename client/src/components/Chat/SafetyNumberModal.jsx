import React, { useState, useEffect } from 'react';
import { computeFingerprint } from '../../utils/e2ee';
import api from '../../services/api';

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
      // 1. My device fingerprint (chỉ lấy thiết bị đang hoạt động, bỏ qua thiết bị đã revoke)
      const myActiveDevice = user.devices?.find(d => !d.isRevoked);
      if (myActiveDevice) {
        const fp = await computeFingerprint(myActiveDevice.publicKey);
        setMyFingerprint(fp);
      } else {
        setMyFingerprint('Chưa đăng ký thiết bị');
      }

      // 2. Contact device fingerprint — room/members populate không bao giờ trả devices
      // (tránh lộ metadata thiết bị cho người khác trong phòng), nên phải gọi riêng
      // endpoint /api/users/:id/devices đã lọc sẵn chỉ thiết bị đang hoạt động.
      try {
        const { data: contactDevices } = await api.get(`/users/${contactUser._id}/devices`);
        if (contactDevices && contactDevices.length > 0) {
          const fp = await computeFingerprint(contactDevices[0].publicKey);
          setContactFingerprint(fp);
        } else {
          setContactFingerprint('Chưa đăng ký thiết bị');
        }
      } catch (err) {
        console.error('[E2EE] Không thể tải thiết bị của đối phương:', err);
        setContactFingerprint('Không thể tải mã của đối phương');
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
    <div className="modal modal-open bg-black/50 backdrop-blur-sm z-50" onClick={onClose}>
      <div className="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-base-300 pb-3 mb-4">
          <h3 className="text-base font-bold flex items-center gap-1.5">
            🔐 Mã An Toàn (Safety Number)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            ✕
          </button>
        </div>

        <div className="text-xs text-base-content/70 space-y-3">
          <p>
            So sánh mã an toàn này với đối phương qua kênh liên lạc trực tiếp (quét mã / điện thoại) để đảm bảo không ai can thiệp vào cuộc trò chuyện.
          </p>

          <div className="bg-base-200 border border-base-300 rounded-xl p-3.5 space-y-2">
            <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider">Mã của bạn ({user.nickname || user.username})</span>
            <p className="font-mono text-xs font-bold text-base-content break-all leading-relaxed bg-base-100 border border-base-300 p-2 rounded-lg text-center select-all">
              {myFingerprint}
            </p>
          </div>

          <div className="bg-base-200 border border-base-300 rounded-xl p-3.5 space-y-2">
            <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider">Mã của {contactUser.nickname || contactUser.username}</span>
            <p className="font-mono text-xs font-bold text-base-content break-all leading-relaxed bg-base-100 border border-base-300 p-2 rounded-lg text-center select-all">
              {contactFingerprint}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-base-300 mt-3">
          <button
            type="button"
            onClick={toggleVerify}
            className={`btn btn-sm rounded-full ${isVerified ? 'btn-success text-white' : 'btn-ghost bg-base-200'}`}
          >
            {isVerified ? '✓ Đã xác minh an toàn' : 'Đánh dấu đã xác minh'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm btn-ghost bg-base-200 rounded-full"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
