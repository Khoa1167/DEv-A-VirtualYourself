import { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import useTimedMessage from '../../hooks/useTimedMessage';

export default function ProfileModal({ onClose }) {
  const { user, setUser } = useAuth();
  const [tab, setTab] = useState('info'); // 'info' | 'password'
  const [now] = useState(() => Date.now());
  const fileInputRef = useRef(null);
  const coverInputRef = useRef(null);

  // ── Form thông tin ──
  const [form, setForm] = useState({
    nickname: user.nickname || '',
    email: user.email || '',
    phone: user.phone || '',
    dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '',
    gender: user.gender || '',
    bio: user.bio || '',
  });
  const [nicknameStatus, setNicknameStatus] = useState('');
  const [infoError, setInfoError] = useState('');
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoSuccess, setInfoSuccess] = useState('');
  const nicknameTimerRef = useRef(null);

  // ── Form đổi Email có xác thực OTP ──
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailStep, setEmailStep] = useState(1); // 1: password + newEmail, 2: OTP
  const [emailForm, setEmailForm] = useState({ currentPassword: '', newEmail: '', otp: '' });
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // ── Form đổi mật khẩu ──
  const [pwForm, setPwForm] = useState({
    currentPassword: '', newPassword: '', confirmPassword: ''
  });
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, setPwSuccess] = useState('');

  // ── Avatar ──
  const [avatarPreview, setAvatarPreview] = useState(user.avatar || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [mediaError, showMediaError] = useTimedMessage();

  // Kiểm tra nickname realtime với debounce
  const checkNickname = (value) => {
    setForm(prev => ({ ...prev, nickname: value }));
    if (nicknameTimerRef.current) {
      clearTimeout(nicknameTimerRef.current);
    }

    if (value === user.nickname || value.trim().length < 2) {
      setNicknameStatus('');
      return;
    }

    setNicknameStatus('checking');
    nicknameTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.post('/auth/check-nickname', { nickname: value });
        setNicknameStatus(data.available ? 'available' : 'taken');
      } catch {
        setNicknameStatus('');
      }
    }, 200);
  };

  const handleSelectAvatar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleUploadAvatar = async () => {
    if (!avatarFile) return;
    setAvatarLoading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', avatarFile);
      const { data } = await api.post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUser(data);
      setAvatarFile(null);
    } catch (err) {
      showMediaError(err.response?.data?.message || 'Upload avatar thất bại');
    } finally {
      setAvatarLoading(false);
    }
  };

  // ── Cover Image ──
  const [coverPreview, setCoverPreview] = useState(user.cover || '');
  const [coverFile, setCoverFile] = useState(null);
  const [coverLoading, setCoverLoading] = useState(false);

  const handleSelectCover = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleUploadCover = async () => {
    if (!coverFile) return;
    setCoverLoading(true);
    try {
      const formData = new FormData();
      formData.append('cover', coverFile);
      const { data } = await api.post('/auth/cover', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUser(data);
      setCoverFile(null);
    } catch (err) {
      showMediaError(err.response?.data?.message || 'Upload ảnh bìa thất bại');
    } finally {
      setCoverLoading(false);
    }
  };

  const handleDeleteCover = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa ảnh bìa?')) return;
    setCoverLoading(true);
    try {
      const { data } = await api.delete('/auth/cover');
      setUser(data);
      setCoverPreview('');
      setCoverFile(null);
    } catch (err) {
      showMediaError(err.response?.data?.message || 'Xóa ảnh bìa thất bại');
    } finally {
      setCoverLoading(false);
    }
  };

  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);
    try {
      const { data } = await api.post('/auth/request-email-change', {
        currentPassword: emailForm.currentPassword,
        newEmail: emailForm.newEmail,
      });
      setEmailSuccess(data.message);
      setEmailStep(2);
    } catch (err) {
      setEmailError(err.response?.data?.message || 'Yêu cầu đổi email thất bại');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleVerifyEmailChange = async (e) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);
    try {
      const { data } = await api.post('/auth/verify-email-change', {
        newEmail: emailForm.newEmail,
        otp: emailForm.otp,
      });
      setUser(data.user);
      setForm(prev => ({ ...prev, email: data.user.email }));
      setInfoSuccess('Đổi email thành công!');
      setShowEmailModal(false);
      setEmailStep(1);
      setEmailForm({ currentPassword: '', newEmail: '', otp: '' });
    } catch (err) {
      setEmailError(err.response?.data?.message || 'Xác nhận mã OTP thất bại');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleSaveInfo = async (e) => {
    e.preventDefault();
    setInfoError('');
    setInfoSuccess('');

    if (nicknameStatus === 'taken') {
      setInfoError('Tên hiển thị đã tồn tại'); return;
    }

    setInfoLoading(true);
    try {
      const { data } = await api.put('/auth/profile', form);
      setUser(data);
      setInfoSuccess('Cập nhật thành công!');
    } catch (err) {
      setInfoError(err.response?.data?.message || 'Cập nhật thất bại');
    } finally {
      setInfoLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('Mật khẩu mới xác nhận không khớp'); return;
    }

    setPwLoading(true);
    try {
      await api.put('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwSuccess('Đổi mật khẩu thành công!');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwError(err.response?.data?.message || 'Đổi mật khẩu thất bại');
    } finally {
      setPwLoading(false);
    }
  };

  const getNicknameMsg = () => {
    if (nicknameStatus === 'checking') return <span className="text-xs text-info flex items-center gap-1 mt-1">⏳ Đang kiểm tra...</span>;
    if (nicknameStatus === 'available') return <span className="text-xs text-success flex items-center gap-1 mt-1">✅ Có thể dùng</span>;
    if (nicknameStatus === 'taken') return <span className="text-xs text-error flex items-center gap-1 mt-1">❌ Đã tồn tại</span>;
    return null;
  };

  return (
    <div className="modal modal-open bg-black/50 backdrop-blur-sm z-50" onClick={onClose}>
      <div className="modal-box p-0 max-w-md bg-base-100 border border-base-300 shadow-2xl" onClick={e => e.stopPropagation()}>
        {mediaError && (
          <div className="toast toast-top toast-center z-[110]">
            <div className="alert alert-error text-sm">
              <span>{mediaError}</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="p-5 pb-4 border-b border-base-300 flex items-center justify-between">
          <h2 className="text-lg font-bold">Cài đặt cá nhân</h2>
          <button className="btn btn-sm btn-ghost bg-base-200 rounded-full" onClick={onClose}>✕ Đóng</button>
        </div>

        <div className="overflow-y-auto max-h-[70vh] p-6 hide-scrollbar flex flex-col gap-5">
          {/* Cover & Avatar Header */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-full h-32 rounded-xl bg-gradient-to-r from-primary to-secondary overflow-hidden shadow-xs group">
              {coverPreview ? (
                <img src={coverPreview} alt="cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center text-primary-content/50 text-xs font-semibold">
                  Chưa có ảnh bìa
                </div>
              )}
              <div
                className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1.5 cursor-pointer backdrop-blur-[1px]"
                onClick={() => coverInputRef.current?.click()}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Đổi ảnh bìa</span>
              </div>

              {user.cover && !coverFile && (
                <button
                  type="button"
                  className="btn btn-xs bg-black/60 hover:bg-error border-none text-white absolute top-2.5 right-2.5 z-10 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCover();
                  }}
                  title="Xóa ảnh bìa"
                >
                  ✕ Xóa ảnh bìa
                </button>
              )}

              <input
                type="file"
                ref={coverInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleSelectCover}
              />
            </div>

            {/* Avatar Section */}
            <div
              className="avatar group relative cursor-pointer shadow-md -mt-10"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-20 rounded-full bg-primary text-primary-content font-bold text-2xl ring-4 ring-base-100 shadow-md">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="avatar" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center">{(user.nickname || user.username)[0].toUpperCase()}</span>
                )}
              </div>
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleSelectAvatar}
            />
          </div>

          {/* Tabs */}
          <div role="tablist" className="tabs tabs-bordered w-full mb-2">
            <button
              role="tab"
              className={`tab flex-1 font-bold ${tab === 'info' ? 'tab-active' : ''}`}
              onClick={() => setTab('info')}
            >
              Thông tin tài khoản
            </button>
            <button
              role="tab"
              className={`tab flex-1 font-bold ${tab === 'password' ? 'tab-active' : ''}`}
              onClick={() => setTab('password')}
            >
              Đổi mật khẩu
            </button>
          </div>

          {/* Tab: Thông tin */}
          {tab === 'info' && (
            <form onSubmit={handleSaveInfo} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Tên tài khoản</label>
                <input value={user.username} disabled className="input input-bordered input-sm bg-base-200 text-base-content/40 w-full select-none" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Biệt danh</label>
                <p className="text-[10px] text-base-content/40">
                  Biệt danh chỉ được thay đổi <strong className="text-base-content font-semibold">7 ngày 1 lần</strong>
                </p>
                {(() => {
                  const canChange = !user.nicknameChangedAt ||
                    (now - new Date(user.nicknameChangedAt)) / (1000 * 60 * 60 * 24) >= 7;
                  const daysLeft = user.nicknameChangedAt
                    ? Math.ceil(7 - (now - new Date(user.nicknameChangedAt)) / (1000 * 60 * 60 * 24))
                    : 0;

                  return canChange ? (
                    <>
                      <input
                        className="input input-bordered input-sm focus:input-primary w-full"
                        value={form.nickname}
                        onChange={e => checkNickname(e.target.value)}
                        minLength={2}
                      />
                      <div className="min-h-[16px]">{getNicknameMsg()}</div>
                    </>
                  ) : (
                    <>
                      <input value={form.nickname} disabled className="input input-bordered input-sm bg-base-200 text-base-content/40 w-full select-none" />
                      <p className="text-[10px] text-error font-semibold mt-1">
                        ⚠️ Còn {daysLeft} ngày nữa mới được đổi tên hiển thị
                      </p>
                    </>
                  );
                })()}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Email</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailError('');
                      setEmailSuccess('');
                      setEmailStep(1);
                      setEmailForm({ currentPassword: '', newEmail: '', otp: '' });
                      setShowEmailModal(true);
                    }}
                    className="text-xs text-primary hover:underline font-bold cursor-pointer"
                  >
                    Đổi Email
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    disabled
                    className="input input-bordered input-sm bg-base-200 text-base-content/50 w-full select-none"
                    value={user.email || ''}
                  />
                  <span className="badge badge-success badge-outline shrink-0 gap-1">
                    ✓ Đã xác minh
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Số điện thoại</label>
                <input
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="Chưa thêm số điện thoại"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Ngày sinh</label>
                <input
                  type="date"
                  className="input input-bordered input-sm focus:input-primary w-full cursor-pointer"
                  value={form.dateOfBirth}
                  onChange={e => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Giới tính</label>
                <select
                  className="select select-bordered select-sm focus:select-primary w-full cursor-pointer"
                  value={form.gender}
                  onChange={e => setForm({ ...form, gender: e.target.value })}
                >
                  <option value="">-- Chưa chọn --</option>
                  <option value="male">Nam</option>
                  <option value="female">Nữ</option>
                  <option value="other">Khác</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mô tả bản thân</label>
                  <span className="text-[10px] text-base-content/40 font-medium">{form.bio.length}/150</span>
                </div>
                <textarea
                  rows={3}
                  maxLength={150}
                  className="textarea textarea-bordered focus:textarea-primary text-sm w-full resize-none"
                  placeholder="Giới thiệu một chút về bản thân bạn..."
                  value={form.bio}
                  onChange={e => setForm({ ...form, bio: e.target.value })}
                />
              </div>

              {infoError && (
                <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-lg">
                  <span>{infoError}</span>
                </div>
              )}
              {infoSuccess && (
                <div className="alert alert-success py-2 px-3 text-xs font-semibold rounded-lg">
                  <span>{infoSuccess}</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary text-white rounded-full mt-2" disabled={infoLoading}>
                {infoLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </form>
          )}

          {/* Tab: Đổi mật khẩu */}
          {tab === 'password' && (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mật khẩu hiện tại</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.currentPassword}
                  onChange={e => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mật khẩu mới</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.newPassword}
                  onChange={e => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  required minLength={6}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.confirmPassword}
                  onChange={e => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                  required
                />
              </div>

              {pwError && (
                <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-lg">
                  <span>{pwError}</span>
                </div>
              )}
              {pwSuccess && (
                <div className="alert alert-success py-2 px-3 text-xs font-semibold rounded-lg">
                  <span>{pwSuccess}</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary text-white rounded-full mt-2" disabled={pwLoading}>
                {pwLoading ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
            </form>
          )}
        </div>

        {/* Popup Floating Confirm Bar cho Ảnh bìa */}
        {coverFile && (
          <div className="absolute bottom-4 left-4 right-4 z-30 bg-neutral text-neutral-content backdrop-blur-md p-3.5 rounded-xl shadow-2xl flex items-center justify-between border border-white/10 animate-fade-in">
            <div className="text-xs font-semibold">
              <span>Xác nhận lưu ảnh bìa mới?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCoverFile(null);
                  setCoverPreview(user.cover || '');
                }}
                className="btn btn-xs bg-white/10 hover:bg-white/20 border-none text-neutral-content/70 hover:text-white"
                disabled={coverLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUploadCover}
                disabled={coverLoading}
                className="btn btn-xs btn-primary text-white"
              >
                {coverLoading ? 'Đang lưu...' : 'Lưu ảnh bìa'}
              </button>
            </div>
          </div>
        )}

        {/* Popup Floating Confirm Bar cho Avatar */}
        {avatarFile && (
          <div className="absolute bottom-4 left-4 right-4 z-30 bg-neutral text-neutral-content backdrop-blur-md p-3.5 rounded-xl shadow-2xl flex items-center justify-between border border-white/10 animate-fade-in">
            <div className="text-xs font-semibold">
              <span>Xác nhận lưu avatar mới?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAvatarFile(null);
                  setAvatarPreview(user.avatar || '');
                }}
                className="btn btn-xs bg-white/10 hover:bg-white/20 border-none text-neutral-content/70 hover:text-white"
                disabled={avatarLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUploadAvatar}
                disabled={avatarLoading}
                className="btn btn-xs btn-primary text-white"
              >
                {avatarLoading ? 'Đang lưu...' : 'Lưu Avatar'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Đổi Email Bảo Mật (OTP) */}
        {showEmailModal && (
          <div className="modal modal-open bg-black/50 backdrop-blur-sm z-[60]" onClick={() => setShowEmailModal(false)}>
            <div className="modal-box max-w-sm bg-base-100 border border-base-300 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-base-300 pb-3 mb-4">
                <h3 className="text-base font-bold">
                  {emailStep === 1 ? 'Thay đổi địa chỉ Email' : 'Nhập mã xác minh OTP'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="btn btn-sm btn-circle btn-ghost"
                >
                  ✕
                </button>
              </div>

              {emailStep === 1 ? (
                <form onSubmit={handleRequestEmailChange} className="flex flex-col gap-4">
                  <p className="text-xs text-base-content/60">
                    Để đảm bảo an toàn tài khoản, vui lòng nhập <strong>mật khẩu hiện tại</strong> và <strong>email mới</strong>. Mã OTP xác thực sẽ được gửi tới <strong>email mới</strong> và một thông báo cảnh báo bảo mật sẽ được gửi về <strong>email hiện tại</strong> của bạn.
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mật khẩu hiện tại</label>
                    <input
                      type="password"
                      required
                      className="input input-bordered input-sm focus:input-primary w-full"
                      value={emailForm.currentPassword}
                      onChange={e => setEmailForm({ ...emailForm, currentPassword: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Email mới</label>
                    <input
                      type="email"
                      required
                      className="input input-bordered input-sm focus:input-primary w-full"
                      value={emailForm.newEmail}
                      onChange={e => setEmailForm({ ...emailForm, newEmail: e.target.value })}
                      placeholder="example@gmail.com"
                    />
                  </div>

                  {emailError && (
                    <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-lg">
                      <span>{emailError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setShowEmailModal(false)}
                      className="btn btn-sm btn-ghost bg-base-200 rounded-full"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={emailLoading}
                      className="btn btn-sm btn-primary text-white rounded-full"
                    >
                      {emailLoading ? 'Đang gửi mã...' : 'Gửi mã OTP'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleVerifyEmailChange} className="flex flex-col gap-4">
                  <div className="alert alert-info text-xs py-2.5 px-3 rounded-lg">
                    <span>{emailSuccess || `Mã OTP 6 số đã được gửi tới địa chỉ email mới (${emailForm.newEmail}).`}</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mã OTP (6 chữ số)</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      className="input input-bordered focus:input-primary text-center tracking-[8px] font-mono font-bold text-lg w-full"
                      value={emailForm.otp}
                      onChange={e => setEmailForm({ ...emailForm, otp: e.target.value })}
                      placeholder="123456"
                    />
                  </div>

                  {emailError && (
                    <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-lg">
                      <span>{emailError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <button
                      type="button"
                      onClick={() => setEmailStep(1)}
                      className="text-xs text-primary hover:underline font-bold cursor-pointer"
                    >
                      ← Nhập lại email
                    </button>
                    <button
                      type="submit"
                      disabled={emailLoading}
                      className="btn btn-sm btn-primary text-white rounded-full"
                    >
                      {emailLoading ? 'Đang xác thực...' : 'Xác nhận Đổi Email'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}