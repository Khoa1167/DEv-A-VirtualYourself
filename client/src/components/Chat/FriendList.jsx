/* eslint-disable no-unused-vars */
import { useState, useEffect, useRef } from 'react';
import Toast from '../common/Toast';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import useTimedMessage from '../../hooks/useTimedMessage';
import api from '../../services/api';

export default function FriendList({ onSelectDM, onViewProfile }) {
  const { user } = useAuth();
  const token = sessionStorage.getItem('token');
  const { on, emit }            = useSocket(token);
  const [friends, setFriends]   = useState([]);
  const [requests, setRequests] = useState([]);
  const [groupInvites, setGroupInvites] = useState([]);
  const [searchQ, setSearchQ]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeTab, setActiveTab] = useState('friends');
  const [actionError, showActionError] = useTimedMessage();
  const [actionSuccess, showActionSuccess] = useTimedMessage();

  // Load danh sách bạn bè và lời mời
  useEffect(() => {
    api.get('/friends').then(res => setFriends(res.data));
    api.get('/friends/requests').then(res => setRequests(res.data));
    api.get('/rooms/invites/mine').then(res => setGroupInvites(res.data));
  }, []);

  // Lắng nghe lời mời kết bạn realtime
  useEffect(() => {
    const off = on('friend:request_received', (friendship) => {
      // friendship là object đầy đủ từ server, có _id và sender
      setRequests(prev => [...prev, friendship]);
    });
    return off;
  }, [on]);

  // Lắng nghe lời mời vào nhóm realtime (admin bấm "Thêm thành viên")
  useEffect(() => {
    const off = on('room:invite_received', ({ roomId, roomName }) => {
      setGroupInvites(prev => prev.some(r => r._id === roomId) ? prev : [...prev, { _id: roomId, name: roomName }]);
    });
    return off;
  }, [on]);

  // Lắng nghe chấp nhận kết bạn realtime — gỡ khỏi tab "Lời mời" nếu action xảy ra từ nơi khác
  // (Profile Modal, hoặc tab khác cùng tài khoản), không thì "Lời mời kết bạn" ở đây bị kẹt lại
  // tới khi tải lại trang.
  useEffect(() => {
    const off = on('friend:request_accepted', ({ friendshipId }) => {
      setRequests(prev => prev.filter(r => r._id !== friendshipId));
      api.get('/friends').then(res => setFriends(res.data));
    });
    return off;
  }, [on]);

  // Lắng nghe từ chối/hủy lời mời kết bạn realtime (từ Profile Modal hoặc tab khác)
  useEffect(() => {
    const offRejected = on('friend:request_rejected', ({ friendshipId }) => {
      setRequests(prev => prev.filter(r => r._id !== friendshipId));
    });
    const offCancelled = on('friend:request_cancelled', ({ friendshipId }) => {
      setRequests(prev => prev.filter(r => r._id !== friendshipId));
    });
    return () => { offRejected(); offCancelled(); };
  }, [on]);

  // Lắng nghe hủy kết bạn realtime (từ Profile Modal hoặc tab khác)
  useEffect(() => {
    const off = on('friend:unfriended', ({ friendshipId }) => {
      setFriends(prev => prev.filter(f => f._id !== friendshipId));
    });
    return off;
  }, [on]);

  // Cập nhật trạng thái online/offline của bạn bè realtime
  useEffect(() => {
    const updateFriendOnline = (userId, isOnline) => {
      setFriends(prev => prev.map(f => {
        if (f.sender?._id?.toString() === userId?.toString()) {
          return { ...f, sender: { ...f.sender, isOnline } };
        }
        if (f.receiver?._id?.toString() === userId?.toString()) {
          return { ...f, receiver: { ...f.receiver, isOnline } };
        }
        return f;
      }));
    };
    const offOnline = on('user:online', ({ userId }) => updateFriendOnline(userId, true));
    const offOffline = on('user:offline', ({ userId }) => updateFriendOnline(userId, false));
    return () => { offOnline(); offOffline(); };
  }, [on]);

  // Tìm kiếm user — debounce 400ms + bỏ qua response đến muộn không còn khớp searchQ hiện tại.
  // Không thì gõ nhanh dễ bị request cũ (ký tự trước) trả về sau và ghi đè mất kết quả đúng —
  // "lúc tìm được lúc không" tùy tốc độ gõ/độ trễ mạng.
  const latestSearchQRef = useRef('');
  useEffect(() => {
    latestSearchQRef.current = searchQ;
    if (searchQ.trim().length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const { data } = await api.get(`/friends/search?q=${searchQ}`);
        if (latestSearchQRef.current === searchQ) setSearchResults(data);
      } catch (err) {
        console.error(err);
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchQ]);

  const handleSearch = (e) => setSearchQ(e.target.value);

  // Gửi lời mời kết bạn
  const sendRequest = async (userId) => {
    showActionError('');
    try {
      const { data } = await api.post(`/friends/request/${userId}`);
      // Gửi kèm toàn bộ friendship object để receiver có đủ thông tin
      emit('friend:request', { receiverId: userId, friendship: data });
      setSearchResults(prev =>
        prev.map(u => u._id === userId ? { ...u, requested: true } : u)
      );
      showActionSuccess('Đã gửi lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi gửi lời mời');
    }
  };

  // Hủy lời mời đã gửi (tái sử dụng endpoint /friends/cancel đã có, dùng trong OtherUserProfileModal)
  const cancelRequest = async (userId) => {
    showActionError('');
    try {
      await api.delete(`/friends/cancel/${userId}`);
      setSearchResults(prev => prev.map(u => u._id === userId ? { ...u, requested: false } : u));
      showActionSuccess('Đã hủy lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi hủy lời mời');
    }
  };

  // Chấp nhận lời mời
  const acceptRequest = async (friendship) => {
    showActionError('');
    try {
      await api.put(`/friends/accept/${friendship._id}`);
      // Join DM room + báo cho người gửi lời mời giờ server tự lo trong route accept ở trên
      // (server verify chắc chắn sender/receiver/dmRoom từ DB — không còn emit chưa xác thực)
      setRequests(prev => prev.filter(r => r._id !== friendship._id));
      api.get('/friends').then(res => setFriends(res.data));
      showActionSuccess('Kết bạn thành công');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi chấp nhận lời mời');
    }
  };

  // Từ chối lời mời
  const rejectRequest = async (friendshipId) => {
    showActionError('');
    try {
      await api.put(`/friends/reject/${friendshipId}`);
      setRequests(prev => prev.filter(r => r._id !== friendshipId));
      showActionSuccess('Đã từ chối lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi từ chối lời mời');
    }
  };

  // Chấp nhận lời mời vào nhóm (được admin thêm qua "Thêm thành viên")
  const acceptGroupInvite = async (roomId) => {
    showActionError('');
    try {
      await api.put(`/rooms/${roomId}/invites/accept`);
      setGroupInvites(prev => prev.filter(r => r._id !== roomId));
      showActionSuccess('Đã tham gia nhóm');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi tham gia nhóm');
    }
  };

  // Từ chối lời mời vào nhóm
  const declineGroupInvite = async (roomId) => {
    showActionError('');
    try {
      await api.delete(`/rooms/${roomId}/invites/decline`);
      setGroupInvites(prev => prev.filter(r => r._id !== roomId));
      showActionSuccess('Đã từ chối lời mời vào nhóm');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Lỗi từ chối lời mời');
    }
  };

  // Mở DM với bạn bè
  const openDM = async (friendId) => {
    showActionError('');
    try {
      const { data } = await api.get(`/friends/dm/${friendId}`);
      onSelectDM(data);
    } catch (err) {
      showActionError('Không tìm thấy phòng DM');
    }
  };

  return (
    <div className="flex flex-col h-full bg-base-100 text-base-content font-sans select-none">
      {/* Header Trang bạn bè */}
      <div className="h-[60px] border-b border-base-300 px-4 flex items-center gap-4 text-sm font-semibold select-none flex-shrink-0">
        <span className="text-xl">👥</span>
        <span className="font-bold text-[16px]">Bạn bè</span>

        <div className="divider divider-horizontal my-2" />

        {/* Các tab chuyển đổi */}
        <div role="tablist" className="tabs tabs-boxed text-xs bg-transparent gap-1">
          <button
            role="tab"
            className={`tab ${activeTab === 'friends' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('friends')}
          >
            Tất cả bạn bè {friends.length > 0 && `(${friends.length})`}
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === 'requests' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            Lời mời kết bạn {requests.length > 0 && `(${requests.length})`}
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === 'groupInvites' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('groupInvites')}
          >
            Lời mời vào nhóm {groupInvites.length > 0 && `(${groupInvites.length})`}
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === 'search' ? 'tab-active bg-primary text-primary-content' : 'text-primary'}`}
            onClick={() => setActiveTab('search')}
          >
            Thêm bạn mới
          </button>
        </div>
      </div>

      <Toast message={actionError} type="error" variant="banner" />
      <Toast message={actionSuccess} type="success" variant="banner" />

      {/* Tab: Danh sách bạn bè */}
      {activeTab === 'friends' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-2">
          <h4 className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-2 px-1">
            Tất cả bạn bè ({friends.length})
          </h4>
          {friends.length === 0 && (
            <p className="text-sm text-center text-base-content/40 py-12 italic">Chưa có bạn bè nào. Hãy thử kết bạn với những người khác nhé!</p>
          )}
          {friends.map(f => {
            const friend = f.sender?._id?.toString() === user?._id?.toString() ? f.receiver : f.sender;
            return (
              <div key={f._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-base-200 border-b border-base-200 transition-all duration-150 group">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onViewProfile && friend?._id && onViewProfile(friend._id)}
                >
                  <div className={`avatar ${friend?.isOnline ? 'avatar-online' : 'avatar-offline'}`}>
                    <div className="w-10 rounded-full ring-1 ring-base-300 group-hover:ring-primary transition-all">
                      {friend?.avatar ? (
                        <img src={friend.avatar} alt="avatar" />
                      ) : (
                        <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold">
                          {(friend?.nickname || '?')[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                      {friend?.nickname || 'Người dùng'}
                    </span>
                    <span className="text-[11px] text-base-content/40">Xem hồ sơ</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-sm btn-ghost bg-base-200 rounded-full font-semibold"
                    onClick={() => onViewProfile && friend?._id && onViewProfile(friend._id)}
                  >
                    Hồ sơ
                  </button>
                  <button className="btn btn-sm btn-primary rounded-full text-white font-bold" onClick={() => openDM(friend?._id)}>
                    Nhắn tin
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Lời mời kết bạn */}
      {activeTab === 'requests' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-2">
          <h4 className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-2 px-1">
            Yêu cầu kết bạn chờ duyệt ({requests.length})
          </h4>
          {requests.length === 0 && (
            <p className="text-sm text-center text-base-content/40 py-12 italic">Không có lời mời kết bạn nào</p>
          )}
          {requests.map(req => (
            <div key={req._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-base-200 border-b border-base-200 transition-all duration-150 group">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => onViewProfile && req.sender?._id && onViewProfile(req.sender._id)}
              >
                <div className="avatar placeholder">
                  <div className="w-10 rounded-full bg-base-200 text-base-content ring-1 ring-transparent group-hover:ring-primary transition-all">
                    {req.sender?.avatar ? (
                      <img src={req.sender.avatar} alt="avatar" />
                    ) : (
                      <span className="font-bold">{(req.sender?.nickname || req.sender?.username || '?')[0].toUpperCase()}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                    {req.sender?.nickname || req.sender?.username}
                  </span>
                  <span className="text-xs text-base-content/50 truncate">Muốn kết nối với bạn</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-ghost bg-base-200 rounded-full font-semibold"
                  onClick={() => onViewProfile && req.sender?._id && onViewProfile(req.sender._id)}
                >
                  Hồ sơ
                </button>
                <button className="btn btn-sm btn-success rounded-full text-white font-bold" onClick={() => acceptRequest(req)}>Đồng ý</button>
                <button className="btn btn-sm btn-error rounded-full text-white font-bold" onClick={() => rejectRequest(req._id)}>Từ chối</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Lời mời vào nhóm */}
      {activeTab === 'groupInvites' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-2">
          <h4 className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-2 px-1">
            Lời mời vào nhóm ({groupInvites.length})
          </h4>
          {groupInvites.length === 0 && (
            <p className="text-sm text-center text-base-content/40 py-12 italic">Không có lời mời vào nhóm nào</p>
          )}
          {groupInvites.map(r => (
            <div key={r._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-base-200 border-b border-base-200 transition-all duration-150 group">
              <div className="flex items-center gap-3">
                <div className="avatar placeholder">
                  <div className="w-10 rounded-full bg-base-200 text-base-content ring-1 ring-transparent">
                    <span className="font-bold">{(r.name || '?')[0].toUpperCase()}</span>
                  </div>
                </div>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-sm font-bold truncate">{r.name || 'Nhóm chat'}</span>
                  <span className="text-xs text-base-content/50 truncate">Mời bạn tham gia nhóm</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-success rounded-full text-white font-bold" onClick={() => acceptGroupInvite(r._id)}>Đồng ý</button>
                <button className="btn btn-sm btn-error rounded-full text-white font-bold" onClick={() => declineGroupInvite(r._id)}>Từ chối</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Tìm bạn / Thêm bạn */}
      {activeTab === 'search' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-bold mb-1">Thêm bạn mới</h3>
            <p className="text-xs text-base-content/50 mb-3">Tìm kiếm bạn bè bằng tên hiển thị trên hệ thống.</p>
            <input
              className="input input-bordered rounded-full w-full bg-base-200 border-transparent focus:bg-base-100"
              placeholder="tìm ai đó"
              value={searchQ}
              onChange={handleSearch}
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            {searchResults.length === 0 && searchQ.length >= 2 && (
              <p className="text-xs text-center text-base-content/40 py-4 italic">Không tìm thấy người dùng nào</p>
            )}
            {searchResults.map(userItem => (
              <div key={userItem._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-base-200 border-b border-base-200 transition-all duration-150 group">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onViewProfile && onViewProfile(userItem._id)}
                >
                  <div className="avatar placeholder">
                    <div className="w-10 rounded-full bg-base-200 text-base-content ring-1 ring-transparent group-hover:ring-primary transition-all">
                      {userItem.avatar ? (
                        <img src={userItem.avatar} alt="avatar" />
                      ) : (
                        <span className="font-bold">{(userItem.nickname || '?')[0].toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                      {userItem.nickname || 'Người dùng'}
                    </span>
                    <span className="text-[11px] text-base-content/40">Xem hồ sơ</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-sm btn-ghost bg-base-200 rounded-full font-semibold"
                    onClick={() => onViewProfile && onViewProfile(userItem._id)}
                  >
                    Hồ sơ
                  </button>
                  <button
                    className={`btn btn-sm rounded-full font-bold ${
                      userItem.requested
                        ? 'bg-warning/10 hover:bg-warning/20 text-warning border-warning/30'
                        : 'btn-primary text-white'
                    }`}
                    onClick={() => userItem.requested ? cancelRequest(userItem._id) : sendRequest(userItem._id)}
                  >
                    {userItem.requested ? 'Đã gửi (Bấm để hủy)' : 'Kết bạn'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}