import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function SetNickname() {
  const [nickname, setNickname]   = useState('');
  const [status, setStatus]       = useState(''); // 'checking' | 'available' | 'taken' | ''
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const navigate                  = useNavigate();
  const { setUser }               = useAuth();

  // Kiểm tra nickname realtime khi người dùng gõ
  useEffect(() => {
    let isMounted = true;
    if (nickname.trim().length < 2) {
      setTimeout(() => {
        if (isMounted) setStatus('');
      }, 0);
      return () => {
        isMounted = false;
      };
    }

    setTimeout(() => {
      if (isMounted) setStatus('checking');
    }, 0);

    const timeout = setTimeout(async () => {
      try {
        const { data } = await api.post('/auth/check-nickname', { nickname });
        if (isMounted) setStatus(data.available ? 'available' : 'taken');
      } catch {
        if (isMounted) setStatus('');
      }
    }, 500); // debounce 500ms

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [nickname]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status !== 'available') return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/set-nickname', { nickname });
      setUser(data);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Đặt nickname thất bại');
    } finally {
      setLoading(false);
    }
  };

  const getStatusMsg = () => {
    if (status === 'checking') return <span className="text-xs text-info flex items-center gap-1 mt-1">⏳ Đang kiểm tra...</span>;
    if (status === 'available') return <span className="text-xs text-success flex items-center gap-1 mt-1">✅ Tên hiển thị có thể dùng</span>;
    if (status === 'taken') return <span className="text-xs text-error flex items-center gap-1 mt-1">❌ Tên hiển thị đã tồn tại, vui lòng chọn tên khác</span>;
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 px-4">
      <div className="card w-full max-w-md bg-base-100 shadow-2xl border border-base-300/50">
        <div className="card-body p-8">
          <h1 className="text-3xl font-bold text-center text-primary mb-2">Biệt danh</h1>
          <p className="text-sm text-center text-base-content/70 mb-6">
            Tên hiển thị là tên người khác thấy khi bạn chat. Bạn có thể thay đổi sau.
          </p>
          
          {error && (
            <div className="alert alert-error shadow-sm py-3 mb-4 rounded-lg">
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-base-content/80">Tên hiển thị (nickname)</span>
              </label>
              <input
                className="input input-bordered focus:input-primary w-full transition-all duration-200"
                placeholder="Nhập tên hiển thị..."
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                required
                minLength={2}
                maxLength={30}
              />
              <div className="min-h-[20px]">{getStatusMsg()}</div>
            </div>
            
            <button
              type="submit"
              className="btn btn-primary w-full mt-2 font-bold shadow-md shadow-primary/25 hover:shadow-lg transition-all duration-200"
              disabled={loading || status !== 'available'}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Đang lưu...
                </>
              ) : 'Xác nhận'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}