import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Turnstile from '../common/Turnstile';

const turnstileEnabled = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function Register() {
  const [step, setStep] = useState(1); // 1: form đăng ký, 2: nhập OTP
  const [form, setForm] = useState({
    username: '', password: '', confirmPassword: '', email: '', phone: ''
  });
  const [turnstileToken, setTurnstileToken] = useState('');
  // Đổi key này sau mỗi lần gửi để buộc widget Turnstile render lại (mỗi token chỉ dùng được 1
  // lần — nếu submit thất bại vì lý do khác (vd trùng username) mà không đổi key, submit lại sẽ
  // gửi token cũ đã bị Cloudflare tiêu thụ, luôn báo "Xác minh CAPTCHA thất bại" oan.
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [otp, setOtp]               = useState('');
  const [usernameStatus, setUsernameStatus] = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [countdown, setCountdown]   = useState(0); // đếm ngược 5 phút
  const navigate                    = useNavigate();

  // Kiểm tra username realtime
  useEffect(() => {
    let isMounted = true;
    if (form.username.trim().length < 3) {
      setTimeout(() => {
        if (isMounted) setUsernameStatus('');
      }, 0);
      return () => {
        isMounted = false;
      };
    }

    setTimeout(() => {
      if (isMounted) setUsernameStatus('checking');
    }, 0);

    const timeout = setTimeout(async () => {
      try {
        const { data } = await api.post('/auth/check-username', { username: form.username });
        if (isMounted) setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        if (isMounted) setUsernameStatus('');
      }
    }, 500);

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [form.username]);

  // Đếm ngược 5 phút sau khi gửi OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Bước 1: Gửi OTP
  const handleSendOTP = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp'); return;
    }
    if (usernameStatus !== 'available') {
      setError('Vui lòng kiểm tra tên tài khoản'); return;
    }

    setLoading(true);
    try {
      await api.post('/auth/send-otp', {
        username: form.username,
        password: form.password,
        email:    form.email,
        phone:    form.phone,
        turnstileToken,
      });
      setStep(2);
      setCountdown(300); // 5 phút
    } catch (err) {
      setError(err.response?.data?.message || 'Gửi OTP thất bại');
    } finally {
      setLoading(false);
      setTurnstileResetKey(k => k + 1);
    }
  };

  // Bước 2: Xác thực OTP
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError('');
    if (otp.length !== 6) {
      setError('OTP phải có 6 chữ số'); return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-otp', {
        email: form.email,
        otp,
      });
      sessionStorage.setItem('token', data.token);
      navigate('/set-nickname', { state: { password: form.password } });
    } catch (err) {
      setError(err.response?.data?.message || 'Xác thực OTP thất bại');
    } finally {
      setLoading(false);
    }
  };

  // Gửi lại OTP
  const handleResendOTP = async () => {
    setError('');
    setOtp('');
    setLoading(true);
    try {
      await api.post('/auth/send-otp', {
        username: form.username,
        password: form.password,
        email:    form.email,
        phone:    form.phone,
        turnstileToken,
      });
      setCountdown(300);
    } catch (err) {
      setError(err.response?.data?.message || 'Gửi lại OTP thất bại');
    } finally {
      setLoading(false);
      setTurnstileResetKey(k => k + 1);
    }
  };

  const getUsernameMsg = () => {
    if (usernameStatus === 'checking') return <span className="text-xs text-info flex items-center gap-1 mt-1">⏳ Đang kiểm tra...</span>;
    if (usernameStatus === 'available') return <span className="text-xs text-success flex items-center gap-1 mt-1">✅ Tên tài khoản có thể dùng</span>;
    if (usernameStatus === 'taken')    return <span className="text-xs text-error flex items-center gap-1 mt-1">❌ Tên tài khoản đã tồn tại</span>;
    return null;
  };

  // ── Giao diện bước 1: Form đăng ký ──
  if (step === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200 px-4 py-8">
        <div className="card w-full max-w-lg bg-base-100 shadow-2xl border border-base-300/50">
          <div className="card-body p-8">
            <h1 className="text-3xl font-bold text-center text-primary mb-2">Đăng ký</h1>
            
            {/* Step indicator */}
            <ul className="steps w-full my-6 text-sm">
              <li className="step step-primary font-semibold">Tài khoản</li>
              <li className="step">Xác thực</li>
            </ul>

            {error && (
              <div className="alert alert-error shadow-sm py-3 mb-4 rounded-lg">
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={handleSendOTP} className="flex flex-col gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold text-base-content/80">Tên tài khoản</span>
                </label>
                <input
                  className="input input-bordered focus:input-primary w-full transition-all duration-200"
                  placeholder="Nhập tên tài khoản (3 - 30 ký tự)..."
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  required minLength={3} maxLength={30}
                />
                <div className="min-h-[20px]">{getUsernameMsg()}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold text-base-content/80">Mật khẩu</span>
                  </label>
                  <input
                    type="password"
                    className="input input-bordered focus:input-primary w-full transition-all duration-200"
                    placeholder="Tối thiểu 6 ký tự..."
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    required minLength={6}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold text-base-content/80">Xác nhận mật khẩu</span>
                  </label>
                  <input
                    type="password"
                    className="input input-bordered focus:input-primary w-full transition-all duration-200"
                    placeholder="Nhập lại mật khẩu..."
                    value={form.confirmPassword}
                    onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold text-base-content/80">Email</span>
                </label>
                <input
                  type="email"
                  className="input input-bordered focus:input-primary w-full transition-all duration-200"
                  placeholder="name@example.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold text-base-content/80">Số điện thoại (tùy chọn)</span>
                </label>
                <input
                  className="input input-bordered focus:input-primary w-full transition-all duration-200"
                  placeholder="Nhập số điện thoại..."
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <Turnstile key={turnstileResetKey} onVerify={setTurnstileToken} />

              <button
                type="submit"
                className="btn btn-primary w-full mt-4 font-bold shadow-md shadow-primary/25 hover:shadow-lg transition-all duration-200"
                disabled={loading || usernameStatus !== 'available' || (turnstileEnabled && !turnstileToken)}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Đang gửi OTP...
                  </>
                ) : 'Tiếp theo →'}
              </button>
            </form>
            
            <div className="text-center mt-6 text-sm text-base-content/60">
              Đã có tài khoản?{' '}
              <Link to="/login" className="link link-primary link-hover font-semibold">
                Đăng nhập
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Giao diện bước 2: Nhập OTP ──
  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 px-4">
      <div className="card w-full max-w-md bg-base-100 shadow-2xl border border-base-300/50">
        <div className="card-body p-8">
          <h1 className="text-3xl font-bold text-center text-primary mb-2">Đăng ký</h1>
          
          {/* Step indicator */}
          <ul className="steps w-full my-6 text-sm">
            <li className="step step-primary">Tài khoản</li>
            <li className="step step-primary font-semibold">Xác thực</li>
          </ul>

          <p className="text-sm text-center text-base-content/75 mb-4">
            Mã OTP đã được gửi tới <strong className="text-base-content">{form.email}</strong>
          </p>

          <div className="flex justify-center mb-6">
            {countdown > 0 ? (
              <div className="alert alert-info py-2 px-4 shadow-sm w-auto rounded-full text-xs font-semibold">
                <span>⏰ Mã hết hạn sau: {formatCountdown(countdown)}</span>
              </div>
            ) : (
              <div className="alert alert-error py-2 px-4 shadow-sm w-auto rounded-full text-xs font-semibold">
                <span>❌ Mã OTP đã hết hạn</span>
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-error shadow-sm py-3 mb-4 rounded-lg">
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerifyOTP} className="flex flex-col gap-4">
            <div className="form-control">
              <input
                className="input input-bordered focus:input-primary w-full tracking-[8px] text-2xl text-center py-6 font-bold"
                placeholder="000000"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full mt-2 font-bold shadow-md shadow-primary/25 hover:shadow-lg transition-all duration-200"
              disabled={loading || countdown === 0 || otp.length !== 6}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Đang xác thực...
                </>
              ) : 'Xác nhận'}
            </button>
          </form>

          {countdown === 0 && (
            <div className="mb-3">
              <Turnstile key={turnstileResetKey} onVerify={setTurnstileToken} />
            </div>
          )}

          <div className="flex justify-between items-center mt-6 text-sm">
            <button
              onClick={() => { setStep(1); setError(''); setOtp(''); }}
              className="btn btn-ghost btn-sm text-primary font-semibold"
            >
              ← Quay lại
            </button>
            <button
              onClick={handleResendOTP}
              disabled={loading || countdown > 0 || (turnstileEnabled && !turnstileToken)}
              className={`btn btn-sm font-semibold ${countdown > 0 ? 'btn-ghost text-base-content/30' : 'btn-ghost text-primary'}`}
            >
              Gửi lại OTP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}