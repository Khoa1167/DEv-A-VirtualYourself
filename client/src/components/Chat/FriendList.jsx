/* eslint-disable no-unused-vars */
import { useState, useEffect } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

export default function FriendList({ onSelectDM, onViewProfile }) {
  const { user } = useAuth();
  const token = sessionStorage.getItem('token');
  const { on, emit }            = useSocket(token);
  const [friends, setFriends]   = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQ, setSearchQ]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeTab, setActiveTab] = useState('friends');

  // Load danh sách bạn bè và lời mời
  useEffect(() => {
    api.get('/friends').then(res => setFriends(res.data));
    api.get('/friends/requests').then(res => setRequests(res.data));
  }, []);

  // Lắng nghe lời mời kết bạn realtime
  useEffect(() => {
    const off = on('friend:request_received', (friendship) => {
      // friendship là object đầy đủ từ server, có _id và sender
      setRequests(prev => [...prev, friendship]);
    });
    return off;
  }, [on]);

  // Lắng nghe chấp nhận kết bạn realtime
  useEffect(() => {
    const off = on('friend:request_accepted', () => {
      api.get('/friends').then(res => setFriends(res.data));
    });
    return off;
  }, [on]);

  // Tìm kiếm user
  const handleSearch = async (e) => {
    const q = e.target.value;
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    try {
      const { data } = await api.get(`/friends/search?q=${q}`);
      setSearchResults(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Gửi lời mời kết bạn
  const sendRequest = async (userId) => {
    try {
      const { data } = await api.post(`/friends/request/${userId}`);
      // Gửi kèm toàn bộ friendship object để receiver có đủ thông tin
      emit('friend:request', { receiverId: userId, friendship: data });
      setSearchResults(prev =>
        prev.map(u => u._id === userId ? { ...u, requested: true } : u)
      );
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi gửi lời mời');
    }
  };

  // Chấp nhận lời mời
  const acceptRequest = async (friendship) => {
    try {
      const { data } = await api.put(`/friends/accept/${friendship._id}`);
      emit('friend:accepted', {
        senderId: friendship.sender?._id || friendship.sender,
        dmRoomId: data.dmRoom._id,
      });
      setRequests(prev => prev.filter(r => r._id !== friendship._id));
      api.get('/friends').then(res => setFriends(res.data));
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi chấp nhận lời mời');
    }
  };

  // Từ chối lời mời
  const rejectRequest = async (friendshipId) => {
    try {
      await api.put(`/friends/reject/${friendshipId}`);
      setRequests(prev => prev.filter(r => r._id !== friendshipId));
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi từ chối lời mời');
    }
  };

  // Mở DM với bạn bè
  const openDM = async (friendId) => {
    try {
      const { data } = await api.get(`/friends/dm/${friendId}`);
      onSelectDM(data);
    } catch (err) {
      alert('Không tìm thấy phòng DM');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-black font-sans select-none">
      {/* Header Trang bạn bè — màu trắng Messenger */}
      <div className="h-[60px] border-b border-gray-200 px-4 flex items-center bg-white gap-4 text-sm font-semibold select-none flex-shrink-0">
        <span className="text-xl">👥</span>
        <span className="font-bold text-gray-900 text-[16px]">Bạn bè</span>

        <div className="w-[1px] h-4 bg-gray-200" />

        {/* Các tab chuyển đổi */}
        <div className="flex gap-1 text-xs">
          <button
            className={`px-3 py-1.5 rounded-full font-semibold cursor-pointer transition-colors ${
              activeTab === 'friends' ? 'bg-[#f0f2f5] text-black' : 'text-gray-500 hover:bg-gray-50'
            }`}
            onClick={() => setActiveTab('friends')}
          >
            Tất cả bạn bè {friends.length > 0 && `(${friends.length})`}
          </button>
          <button
            className={`px-3 py-1.5 rounded-full font-semibold cursor-pointer transition-colors ${
              activeTab === 'requests' ? 'bg-[#f0f2f5] text-black' : 'text-gray-500 hover:bg-gray-50'
            }`}
            onClick={() => setActiveTab('requests')}
          >
            Lời mời kết bạn {requests.length > 0 && `(${requests.length})`}
          </button>
          <button
            className={`px-3 py-1.5 rounded-full font-semibold cursor-pointer transition-colors ${
              activeTab === 'search' ? 'bg-[#0084ff] text-white' : 'bg-[#0084ff]/10 text-[#0084ff] hover:bg-[#0084ff]/20'
            }`}
            onClick={() => setActiveTab('search')}
          >
            Thêm bạn mới
          </button>
        </div>
      </div>

      {/* Tab: Danh sách bạn bè */}
      {activeTab === 'friends' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-2 bg-white">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">
            Tất cả bạn bè ({friends.length})
          </h4>
          {friends.length === 0 && (
            <p className="text-sm text-center text-gray-400 py-12 italic">Chưa có bạn bè nào. Hãy thử kết bạn với những người khác nhé!</p>
          )}
          {friends.map(f => {
            const friend = f.sender?._id?.toString() === user?._id?.toString() ? f.receiver : f.sender;
            return (
              <div key={f._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border-b border-gray-100 transition-all duration-150 group">
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onViewProfile && friend?._id && onViewProfile(friend._id)}
                >
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gray-200 text-white flex items-center justify-center font-bold text-base overflow-hidden ring-1 ring-gray-100 group-hover:ring-[#0084ff] transition-all">
                      {friend?.avatar ? (
                        <img src={friend.avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[#0084ff] flex items-center justify-center text-white">
                          {(friend?.nickname || '?')[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                      friend?.isOnline ? 'bg-[#31a24c]' : 'bg-gray-400'
                    }`} />
                  </div>
                  <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-bold text-gray-900 truncate group-hover:text-[#0084ff] transition-colors">
                      {friend?.nickname || 'Người dùng'}
                    </span>
                    <span className="text-[11px] text-gray-400">Xem hồ sơ</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs px-3 py-2 rounded-full transition-colors cursor-pointer"
                    onClick={() => onViewProfile && friend?._id && onViewProfile(friend._id)}
                  >
                    Hồ sơ
                  </button>
                  <button className="bg-[#0084ff] hover:bg-[#0073de] text-white font-bold text-xs px-4 py-2 rounded-full transition-colors cursor-pointer" onClick={() => openDM(friend?._id)}>
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
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-2 bg-white">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">
            Yêu cầu kết bạn chờ duyệt ({requests.length})
          </h4>
          {requests.length === 0 && (
            <p className="text-sm text-center text-gray-400 py-12 italic">Không có lời mời kết bạn nào</p>
          )}
          {requests.map(req => (
            <div key={req._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border-b border-gray-100 transition-all duration-150 group">
              <div 
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => onViewProfile && req.sender?._id && onViewProfile(req.sender._id)}
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-bold text-base flex-shrink-0 group-hover:ring-2 group-hover:ring-[#0084ff] transition-all overflow-hidden">
                  {req.sender?.avatar ? (
                    <img src={req.sender.avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <span>{(req.sender?.nickname || req.sender?.username || '?')[0].toUpperCase()}</span>
                  )}
                </div>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-sm font-bold text-gray-900 truncate group-hover:text-[#0084ff] transition-colors">
                    {req.sender?.nickname || req.sender?.username}
                  </span>
                  <span className="text-xs text-gray-500 truncate">Muốn kết nối với bạn</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  className="px-3 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs cursor-pointer flex items-center justify-center transition-colors"
                  onClick={() => onViewProfile && req.sender?._id && onViewProfile(req.sender._id)}
                >
                  Hồ sơ
                </button>
                <button className="px-4 py-2 rounded-full bg-[#31a24c] hover:bg-[#28843e] text-white font-bold text-xs cursor-pointer flex items-center justify-center transition-colors" onClick={() => acceptRequest(req)}>Đồng ý</button>
                <button className="px-4 py-2 rounded-full bg-[#f02849] hover:bg-[#d0203c] text-white font-bold text-xs cursor-pointer flex items-center justify-center transition-colors" onClick={() => rejectRequest(req._id)}>Từ chối</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Tìm bạn / Thêm bạn */}
      {activeTab === 'search' && (
        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 flex flex-col gap-4 bg-white">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">Thêm bạn mới</h3>
            <p className="text-xs text-gray-500 mb-3">Tìm kiếm bạn bè bằng tên hiển thị trên hệ thống.</p>
            <input
              className="bg-[#f0f2f5] border border-transparent rounded-full px-4 py-2.5 text-sm text-black placeholder-gray-500 focus:outline-none focus:bg-white focus:border-gray-300 w-full"
              placeholder="tìm ai đó"
              value={searchQ}
              onChange={handleSearch}
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            {searchResults.length === 0 && searchQ.length >= 2 && (
              <p className="text-xs text-center text-gray-400 py-4 italic">Không tìm thấy người dùng nào</p>
            )}
            {searchResults.map(userItem => (
              <div key={userItem._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border-b border-gray-100 transition-all duration-150 group">
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onViewProfile && onViewProfile(userItem._id)}
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-bold text-base flex-shrink-0 group-hover:ring-2 group-hover:ring-[#0084ff] transition-all overflow-hidden">
                    {userItem.avatar ? (
                      <img src={userItem.avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <span>{(userItem.nickname || '?')[0].toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 leading-tight">
                    <span className="text-sm font-bold text-gray-900 truncate group-hover:text-[#0084ff] transition-colors">
                      {userItem.nickname || 'Người dùng'}
                    </span>
                    <span className="text-[11px] text-gray-400">Xem hồ sơ</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    className="font-semibold text-xs px-3 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
                    onClick={() => onViewProfile && onViewProfile(userItem._id)}
                  >
                    Hồ sơ
                  </button>
                  <button
                    className={`font-semibold text-xs px-4 py-2 rounded-full transition-colors cursor-pointer ${
                      userItem.requested 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-[#0084ff] text-white hover:bg-[#0073de]'
                    }`}
                    onClick={() => sendRequest(userItem._id)}
                    disabled={userItem.requested}
                  >
                    {userItem.requested ? 'Đã gửi yêu cầu' : 'Kết bạn'}
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