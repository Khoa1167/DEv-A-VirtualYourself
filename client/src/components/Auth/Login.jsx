import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ForgotPasswordModal from './ForgotPasswordModal';
import Turnstile from '../common/Turnstile';

const turnstileEnabled = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function Login() {
  const [form, setForm]               = useState({ username: '', password: '' });
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Đổi sau mỗi lần submit để buộc Turnstile render lại — token chỉ dùng được 1 lần
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const { login }                     = useAuth();
  const navigate                      = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.username, form.password, turnstileToken);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
      setTurnstileResetKey(k => k + 1);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 px-4">
      <div className="card w-full max-w-md bg-base-100 shadow-2xl border border-base-300/50">
        <div className="card-body p-8">
          <h1 className="text-3xl font-bold text-center text-primary mb-6">Đăng nhập</h1>
          
          {error && (
            <div className="alert alert-error shadow-sm py-3 mb-4 rounded-lg">
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-base-content/80">Tên tài khoản</span>
              </label>
              <input
                className="input input-bordered focus:input-primary w-full transition-all duration-200"
                placeholder="Nhập tên tài khoản..."
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            
            <div className="form-control">
              <div className="flex items-center justify-between">
                <label className="label py-1">
                  <span className="label-text font-semibold text-base-content/80">Mật khẩu</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsForgotOpen(true)}
                  className="text-xs font-semibold text-primary link link-hover"
                >
                  Quên mật khẩu?
                </button>
              </div>
              <input
                type="password"
                className="input input-bordered focus:input-primary w-full transition-all duration-200"
                placeholder="Nhập mật khẩu..."
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            
            <Turnstile key={turnstileResetKey} onVerify={setTurnstileToken} />

            <button
              type="submit"
              className="btn btn-primary w-full mt-2 font-bold shadow-md shadow-primary/25 hover:shadow-lg transition-all duration-200"
              disabled={loading || (turnstileEnabled && !turnstileToken)}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Đang đăng nhập...
                </>
              ) : 'Đăng nhập'}
            </button>
          </form>
          
          <div className="text-center mt-6 text-sm text-base-content/60">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="link link-primary link-hover font-semibold">
              Đăng ký ngay
            </Link>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        isOpen={isForgotOpen}
        onClose={() => setIsForgotOpen(false)}
      />
    </div>
  );
}