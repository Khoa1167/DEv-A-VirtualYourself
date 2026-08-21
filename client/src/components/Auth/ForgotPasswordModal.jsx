import { useState, useEffect } from 'react';
import api from '../../services/api';
import Turnstile from '../common/Turnstile';
import Toast from '../common/Toast';
import PasswordInput from '../common/PasswordInput';
import useTimedMessage from '../../hooks/useTimedMessage';

const turnstileEnabled = !!import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;

export default function ForgotPasswordModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep]                 = useState(1); // 1: Email, 2: OTP, 3: New Password
  const [email, setEmail]               = useState('');
  const [otp, setOtp]                   = useState('');
  const [resetToken, setResetToken]     = useState('');
  const [newPassword, setNewPassword]   = useState('');
  const [confirmPw, setConfirmPw]       = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  // Đổi sau mỗi lần gửi để buộc Turnstile render lại — token chỉ dùng được 1 lần
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const [error, showError]              = useTimedMessage();
  const [successMsg, showSuccessMsg]    = useTimedMessage();
  const [loading, setLoading]           = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Đếm ngược gửi lại OTP (60s)
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const handleClose = () => {
    setStep(1);
    setEmail('');
    setOtp('');
    setResetToken('');
    setNewPassword('');
    setConfirmPw('');
    showError('');
    showSuccessMsg('');
    setTurnstileToken('');
    onClose();
  };

  // Bước 1: Gửi OTP đến Email
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email.trim()) return showError('Vui lòng nhập email');

    showError('');
    showSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.post('/auth/forgot-password', { email, turnstileToken });
      showSuccessMsg(res.data.message || 'Mã OTP đã được gửi đến email của bạn');
      setStep(2);
      setResendCooldown(60);
    } catch (err) {
      showError(err.response?.data?.message || 'Gửi OTP thất bại, vui lòng thử lại');
    } finally {
      setLoading(false);
      setTurnstileResetKey(k => k + 1);
    }
  };

  // Bước 2: Xác thực mã OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp.trim()) return showError('Vui lòng nhập mã OTP');

    showError('');
    showSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.post('/auth/verify-reset-otp', { email, otp });
      setResetToken(res.data.resetToken);
      showSuccessMsg('Xác thực OTP thành công! Vui lòng nhập mật khẩu mới.');
      setStep(3);
    } catch (err) {
      showError(err.response?.data?.message || 'Xác thực OTP thất bại');
    } finally {
      setLoading(false);
    }
  };

  // Bước 3: Đặt lại mật khẩu mới
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      return showError('Mật khẩu mới phải chứa ít nhất 6 ký tự');
    }
    if (newPassword !== confirmPw) {
      return showError('Mật khẩu xác nhận không trùng khớp');
    }

    showError('');
    showSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.post('/auth/reset-password', {
        email,
        resetToken,
        newPassword,
      });
      showSuccessMsg(res.data.message || 'Đổi mật khẩu thành công!');
      setTimeout(() => {
        if (onSuccess) onSuccess();
        handleClose();
      }, 1500);
    } catch (err) {
      showError(err.response?.data?.message || 'Đổi mật khẩu thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal modal-open bg-black/50 backdrop-blur-sm z-50">
      <div className="modal-box relative max-w-md bg-base-100 p-6 rounded-2xl shadow-2xl border border-base-300">
        <button
          onClick={handleClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-4 top-4 text-base-content/60 hover:text-base-content"
        >
          ✕
        </button>

        <h3 className="text-xl font-bold text-center text-primary mb-1">
          {step === 1 && 'Khôi phục mật khẩu'}
          {step === 2 && 'Xác thực mã OTP'}
          {step === 3 && 'Đặt mật khẩu mới'}
        </h3>

        <p className="text-xs text-center text-base-content/60 mb-5">
          {step === 1 && 'Nhập email tài khoản của bạn để nhận mã xác nhận'}
          {step === 2 && `Mã OTP đã gửi tới ${email}`}
          {step === 3 && 'Tạo mật khẩu mới an toàn cho tài khoản của bạn'}
        </p>

        <Toast message={error} type="error" variant="banner" alertClassName="text-xs mb-4 rounded-lg" />
        <Toast message={successMsg} type="success" variant="banner" alertClassName="text-xs mb-4 rounded-lg" />

        {/* BƯỚC 1: NHẬP EMAIL */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-semibold text-xs text-base-content/80">
                  Địa chỉ Email đăng ký
                </span>
              </label>
              <input
                type="email"
                className="input input-bordered focus:input-primary w-full text-sm"
                placeholder="example@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <Turnstile key={turnstileResetKey} onVerify={setTurnstileToken} />
            {turnstileEnabled && !turnstileToken && (
              <span className="text-xs text-error flex items-center justify-center gap-1">❌ Vui lòng xác thực CAPTCHA trước khi tiếp tục</span>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full mt-2 font-bold shadow-md shadow-primary/25"
              disabled={loading || (turnstileEnabled && !turnstileToken)}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Đang gửi mã...
                </>
              ) : (
                'Gửi mã xác nhận'
              )}
            </button>
          </form>
        )}

        {/* BƯỚC 2: NHẬP OTP */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-semibold text-xs text-base-content/80">
                  Mã OTP (6 chữ số)
                </span>
              </label>
              <input
                type="text"
                maxLength={6}
                className="input input-bordered focus:input-primary w-full text-center text-xl font-mono tracking-widest"
                placeholder="------"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full font-bold shadow-md shadow-primary/25"
              disabled={loading || otp.length !== 6}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Đang xác thực...
                </>
              ) : (
                'Xác nhận OTP'
              )}
            </button>

            {resendCooldown === 0 && (
              <div>
                <Turnstile key={turnstileResetKey} onVerify={setTurnstileToken} />
                {turnstileEnabled && !turnstileToken && (
                  <span className="text-xs text-error flex items-center justify-center gap-1 mt-1">❌ Vui lòng xác thực CAPTCHA trước khi gửi lại</span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-base-content/60 mt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="link link-hover text-primary"
              >
                ← Đổi email
              </button>
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={resendCooldown > 0 || loading || (turnstileEnabled && !turnstileToken)}
                className="link link-hover text-primary disabled:text-base-content/40 disabled:no-underline"
              >
                {resendCooldown > 0
                  ? `Gửi lại mã (${resendCooldown}s)`
                  : 'Gửi lại mã OTP'}
              </button>
            </div>
          </form>
        )}

        {/* BƯỚC 3: ĐẶT MẬT KHẨU MỚI */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-semibold text-xs text-base-content/80">
                  Mật khẩu mới
                </span>
              </label>
              <PasswordInput
                className="input input-bordered focus:input-primary w-full text-sm"
                placeholder="Tối thiểu 6 ký tự..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-semibold text-xs text-base-content/80">
                  Xác nhận mật khẩu mới
                </span>
              </label>
              <PasswordInput
                className="input input-bordered focus:input-primary w-full text-sm"
                placeholder="Nhập lại mật khẩu mới..."
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full mt-2 font-bold shadow-md shadow-primary/25"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Đang cập nhật...
                </>
              ) : (
                'Hoàn tất & Đổi mật khẩu'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
