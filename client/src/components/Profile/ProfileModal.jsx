import { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

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

  // Kiểm tra nickname realtime
  const checkNickname = async (value) => {
    setForm(prev => ({ ...prev, nickname: value }));
    if (value === user.nickname || value.trim().length < 2) {
      setNicknameStatus(''); return;
    }
    setNicknameStatus('checking');
    try {
      const { data } = await api.post('/auth/check-nickname', { nickname: value });
      setNicknameStatus(data.available ? 'available' : 'taken');
    } catch {
      setNicknameStatus('');
    }
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
      alert(err.response?.data?.message || 'Upload avatar thất bại');
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
      alert(err.response?.data?.message || 'Upload ảnh bìa thất bại');
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
      alert(err.response?.data?.message || 'Xóa ảnh bìa thất bại');
    } finally {
      setCoverLoading(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="card w-full max-w-md bg-white text-black border border-gray-200 relative overflow-hidden shadow-2xl rounded-2xl font-sans" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 pb-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <h2 className="text-lg font-bold text-gray-900">Cài đặt cá nhân</h2>
          <button className="hover:bg-gray-100 text-gray-500 hover:text-black text-xs cursor-pointer bg-gray-50 px-3 py-1.5 rounded-full font-semibold" onClick={onClose}>✕ Đóng</button>
        </div>

        <div className="overflow-y-auto max-h-[70vh] p-6 hide-scrollbar flex flex-col gap-5 bg-white">
          {/* Cover & Avatar Header */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-full h-32 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 overflow-hidden shadow-xs group">
              {coverPreview ? (
                <img src={coverPreview} alt="cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-center text-white/50 text-xs font-semibold">
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
                  className="absolute top-2.5 right-2.5 z-10 bg-black/60 hover:bg-red-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg backdrop-blur-xs transition-colors cursor-pointer flex items-center gap-1 shadow-sm opacity-0 group-hover:opacity-100"
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
              className="group relative cursor-pointer shadow-md rounded-full -mt-10"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-20 h-20 rounded-full bg-[#0084ff] text-white flex items-center justify-center font-bold text-2xl overflow-hidden ring-4 ring-white shadow-md">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="avatar" className="object-cover w-full h-full" />
                ) : (
                  <span>{(user.nickname || user.username)[0].toUpperCase()}</span>
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
          <div className="flex border-b border-gray-100 w-full mb-2">
            <button
              className={`flex-1 font-bold text-xs pb-2 border-b-2 text-center transition-colors cursor-pointer ${tab === 'info' ? 'border-[#0084ff] text-[#0084ff]' : 'border-transparent text-gray-500 hover:text-black'}`}
              onClick={() => setTab('info')}
            >
              Thông tin tài khoản
            </button>
            <button
              className={`flex-1 font-bold text-xs pb-2 border-b-2 text-center transition-colors cursor-pointer ${tab === 'password' ? 'border-[#0084ff] text-[#0084ff]' : 'border-transparent text-gray-500 hover:text-black'}`}
              onClick={() => setTab('password')}
            >
              Đổi mật khẩu
            </button>
          </div>

          {/* Tab: Thông tin */}
          {tab === 'info' && (
            <form onSubmit={handleSaveInfo} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tên tài khoản</label>
                <input value={user.username} disabled className="bg-gray-50 text-gray-400 border border-gray-100 rounded-lg py-2 px-3 text-sm cursor-not-allowed w-full select-none" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Biệt danh</label>
                <p className="text-[10px] text-gray-400">
                  Biệt danh chỉ được thay đổi <strong className="text-black font-semibold">7 ngày 1 lần</strong>
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
                        className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                        value={form.nickname}
                        onChange={e => checkNickname(e.target.value)}
                        minLength={2}
                      />
                      <div className="min-h-[16px]">{getNicknameMsg()}</div>
                    </>
                  ) : (
                    <>
                      <input value={form.nickname} disabled className="bg-gray-50 text-gray-400 border border-gray-100 rounded-lg py-2 px-3 text-sm cursor-not-allowed w-full select-none" />
                      <p className="text-[10px] text-red-500 font-semibold mt-1">
                        ⚠️ Còn {daysLeft} ngày nữa mới được đổi tên hiển thị
                      </p>
                    </>
                  );
                })()}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Số điện thoại</label>
                <input
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="Chưa thêm số điện thoại"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ngày sinh</label>
                <input
                  type="date"
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full cursor-pointer"
                  value={form.dateOfBirth}
                  onChange={e => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Giới tính</label>
                <select
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full cursor-pointer"
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
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mô tả bản thân</label>
                  <span className="text-[10px] text-gray-400 font-medium">{form.bio.length}/150</span>
                </div>
                <textarea
                  rows={3}
                  maxLength={150}
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full resize-none"
                  placeholder="Giới thiệu một chút về bản thân bạn..."
                  value={form.bio}
                  onChange={e => setForm({ ...form, bio: e.target.value })}
                />
              </div>

              {infoError && (
                <div className="bg-red-50 text-red-500 border border-red-100 py-2 px-3 text-xs font-semibold rounded-lg">
                  {infoError}
                </div>
              )}
              {infoSuccess && (
                <div className="bg-green-50 text-green-600 border border-green-100 py-2 px-3 text-xs font-semibold rounded-lg">
                  {infoSuccess}
                </div>
              )}

              <button type="submit" className="bg-[#0084ff] hover:bg-[#0073de] text-white font-bold text-sm py-2.5 rounded-full transition-colors cursor-pointer shadow-xs mt-2" disabled={infoLoading}>
                {infoLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </form>
          )}

          {/* Tab: Đổi mật khẩu */}
          {tab === 'password' && (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mật khẩu hiện tại</label>
                <input
                  type="password"
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                  value={pwForm.currentPassword}
                  onChange={e => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mật khẩu mới</label>
                <input
                  type="password"
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                  value={pwForm.newPassword}
                  onChange={e => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  required minLength={6}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  className="bg-white border border-gray-200 text-black focus:border-[#0084ff] focus:ring-1 focus:ring-[#0084ff] rounded-lg py-2 px-3 text-sm outline-none w-full"
                  value={pwForm.confirmPassword}
                  onChange={e => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                  required
                />
              </div>

              {pwError && (
                <div className="bg-red-50 text-red-500 border border-red-100 py-2 px-3 text-xs font-semibold rounded-lg">
                  {pwError}
                </div>
              )}
              {pwSuccess && (
                <div className="bg-green-50 text-green-600 border border-green-100 py-2 px-3 text-xs font-semibold rounded-lg">
                  {pwSuccess}
                </div>
              )}

              <button type="submit" className="bg-[#0084ff] hover:bg-[#0073de] text-white font-bold text-sm py-2.5 rounded-full transition-colors cursor-pointer shadow-xs mt-2" disabled={pwLoading}>
                {pwLoading ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
            </form>
          )}
        </div>

        {/* Popup Floating Confirm Bar cho Ảnh bìa */}
        {coverFile && (
          <div className="absolute bottom-4 left-4 right-4 z-30 bg-gray-900/90 text-white backdrop-blur-md p-3.5 rounded-xl shadow-2xl flex items-center justify-between border border-white/10 animate-fade-in">
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
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-300 hover:text-white bg-white/10 hover:bg-white/20 transition-all cursor-pointer"
                disabled={coverLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUploadCover}
                disabled={coverLoading}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#0084ff] hover:bg-[#0073de] text-white shadow-xs transition-all cursor-pointer flex items-center gap-1"
              >
                {coverLoading ? 'Đang lưu...' : 'Lưu ảnh bìa'}
              </button>
            </div>
          </div>
        )}

        {/* Popup Floating Confirm Bar cho Avatar */}
        {avatarFile && (
          <div className="absolute bottom-4 left-4 right-4 z-30 bg-gray-900/90 text-white backdrop-blur-md p-3.5 rounded-xl shadow-2xl flex items-center justify-between border border-white/10 animate-fade-in">
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
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-300 hover:text-white bg-white/10 hover:bg-white/20 transition-all cursor-pointer"
                disabled={avatarLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUploadAvatar}
                disabled={avatarLoading}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#0084ff] hover:bg-[#0073de] text-white shadow-xs transition-all cursor-pointer flex items-center gap-1"
              >
                {avatarLoading ? 'Đang lưu...' : 'Lưu Avatar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}