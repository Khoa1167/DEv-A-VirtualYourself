import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import MessageItem from './MessageItem';
import MessageInput from './MessageInput';
import ForwardModal from './ForwardModal';
import SafetyNumberModal from './SafetyNumberModal';
import api from '../../services/api';
import { encryptMessageForRoom, decryptMessage, getDeviceId } from '../../utils/e2ee';

// Lấy thông tin người đang chat cùng trong phòng DM
const getDMPartner = (room, currentUser) => {
  if (!room?.isDM || !room?.members) return null;
  return room.members.find(m => m._id?.toString() !== currentUser._id?.toString());
};

export default function ChatWindow({ room, onBackToFriends, onInitiateCall, onViewProfile }) {
  const { user }          = useAuth();
  const { emit, on, isConnected } = useSocket();
  const [messages, setMessages]       = useState([]);
  const [typing, setTyping]           = useState([]);
  const [replyTo, setReplyTo]         = useState(null);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);
  const [dmPartnerOnline, setDmPartnerOnline] = useState(
    () => getDMPartner(room, user)?.isOnline || false
  );
  const [showMembers, setShowMembers] = useState(true);
  const [forwardTargetMessage, setForwardTargetMessage] = useState(null);
  const [showForward, setShowForward] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const bottomRef = useRef(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const containerRef = useRef(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isFar = scrollHeight - scrollTop - clientHeight > 300;
    setShowScrollBottom(isFar);
  };

  // Decrypt tin nhắn helper
  const processDecryption = async (rawMessages) => {
    const devId = getDeviceId();
    const decrypted = await Promise.all(
      rawMessages.map(async (m) => {
        if (m.isDeleted) return m;
        const text = await decryptMessage(m, devId);
        return { ...m, decryptedText: text, content: text };
      })
    );
    return decrypted;
  };

  // Load tin nhắn khi chọn phòng mới
  useEffect(() => {
    if (!room) return;

    api.get(`/rooms/${room._id}/messages?page=1&limit=30`)
      .then(async res => {
        const decrypted = await processDecryption(res.data);
        setMessages(decrypted);
        setHasMore(res.data.length === 30);
        setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
      });
  }, [room]);

  // Lắng nghe các sự kiện WebSocket
  useEffect(() => {
    if (!room) return;

    emit('room:join', room._id);

    // Nhận tin nhắn mới
    const offNew = on('message:new', async (msg) => {
      if (msg.room?.toString() === room._id?.toString()) {
        const devId = getDeviceId();
        const decryptedText = await decryptMessage(msg, devId);
        const processedMsg = { ...msg, decryptedText, content: decryptedText };
        setMessages(prev => [...prev, processedMsg]);
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Tin nhắn bị xóa
    const offDeleted = on('message:deleted', ({ messageId }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, isDeleted: true } : m)
      );
    });

    // Tin nhắn được react
    const offReacted = on('message:reacted', ({ messageId, reactions }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, reactions } : m)
      );
    });

    // Tin nhắn được chỉnh sửa
    const offEdited = on('message:edited', async ({ messageId, content, iv, tag, encryptedKeys, isEdited }) => {
      const devId = getDeviceId();
      const decryptedText = await decryptMessage({ content, iv, tag, encryptedKeys }, devId);
      setMessages(prev =>
        prev.map(m => m._id === messageId
          ? { ...m, content: decryptedText, decryptedText, iv, tag, encryptedKeys, isEdited }
          : m)
      );
    });

    // Typing indicator
    const offTypingStart = on('typing:start', ({ userId: uid, username, roomId }) => {
      if (roomId === room._id && uid !== user._id) {
        setTyping(prev => prev.includes(username) ? prev : [...prev, username]);
      }
    });
    const offTypingStop = on('typing:stop', ({ roomId }) => {
      if (roomId === room._id) setTyping([]);
    });

    // Trạng thái online/offline của DM partner
    const partner = getDMPartner(room, user);
    const offOnline = on('user:online', ({ userId }) => {
      if (userId?.toString() === partner?._id?.toString()) {
        setDmPartnerOnline(true);
      }
    });
    const offOffline = on('user:offline', ({ userId }) => {
      if (userId?.toString() === partner?._id?.toString()) {
        setDmPartnerOnline(false);
      }
    });

    return () => {
      offNew(); offDeleted(); offReacted(); offEdited();
      offTypingStart(); offTypingStop();
      offOnline(); offOffline();
    };
  }, [room, user, on, emit, isConnected]);

  const roomId = room?._id;

  const fetchRoomDevicePublicKeys = async (roomToUse) => {
    const allDevicePublicKeys = [];
    if (!roomToUse?.members) return allDevicePublicKeys;

    for (const member of roomToUse.members) {
      try {
        const { data: devices } = await api.get(`/users/${member._id}/devices`);
        if (Array.isArray(devices)) {
          allDevicePublicKeys.push(...devices);
        }
      } catch (err) {
        console.warn(`Lỗi khi lấy public key của member ${member._id}:`, err);
      }
    }

    return allDevicePublicKeys;
  };

  const handleSend = useCallback(async (content, replyToId, type = 'text', fileName = null) => {
    try {
      const allDevicePublicKeys = await fetchRoomDevicePublicKeys(room);
      const encryptedPayload = await encryptMessageForRoom(content, allDevicePublicKeys);

      emit('message:send', {
        roomId,
        content: encryptedPayload.content,
        iv: encryptedPayload.iv,
        tag: encryptedPayload.tag,
        encryptedKeys: encryptedPayload.encryptedKeys,
        type,
        replyTo: replyToId,
        fileName
      });

      setReplyTo(null);
    } catch (err) {
      console.error('[E2EE] Send error:', err);
      alert('Không thể mã hóa tin nhắn E2EE');
    }
  }, [emit, roomId, room]);

  const handleTyping = useCallback((isTyping) => {
    emit(isTyping ? 'typing:start' : 'typing:stop', { roomId });
  }, [emit, roomId]);

  const handleReact = useCallback((messageId, emoji) => {
    emit('message:react', { messageId, emoji });
  }, [emit]);

  const handleForwardClick = useCallback((message) => {
    setForwardTargetMessage(message);
    setShowForward(true);
  }, []);

  const handleForwardSend = useCallback(async (targetRoomId, originalMsg) => {
    if (!originalMsg || originalMsg.isDeleted) {
      alert('Không thể chuyển tiếp tin nhắn đã bị thu hồi.');
      return;
    }

    try {
      const { data: rooms } = await api.get('/rooms');
      const targetRoom = rooms.find(r => r._id === targetRoomId);
      if (!targetRoom) {
        throw new Error('Không tìm thấy phòng để chuyển tiếp.');
      }

      const allDevicePublicKeys = await fetchRoomDevicePublicKeys(targetRoom);
      const encryptedPayload = await encryptMessageForRoom(originalMsg.content, allDevicePublicKeys);

      emit('message:send', {
        roomId: targetRoomId,
        content: encryptedPayload.content,
        iv: encryptedPayload.iv,
        tag: encryptedPayload.tag,
        encryptedKeys: encryptedPayload.encryptedKeys,
        type: originalMsg.type,
        fileName: originalMsg.fileName,
        forwardedFrom: originalMsg._id
      });
    } catch (err) {
      console.error('[E2EE] Forward error:', err);
      alert('Không thể mã hóa tin nhắn chuyển tiếp.');
    }
  }, [emit]);

  const handleEdit = useCallback(async (messageId, newContent) => {
    try {
      const allDevicePublicKeys = await fetchRoomDevicePublicKeys(room);
      const encryptedPayload = await encryptMessageForRoom(newContent, allDevicePublicKeys);

      emit('message:edit', {
        messageId,
        content: encryptedPayload.content,
        iv: encryptedPayload.iv,
        tag: encryptedPayload.tag,
        encryptedKeys: encryptedPayload.encryptedKeys,
      });
    } catch (err) {
      console.error('[E2EE] Edit error:', err);
      alert('Không thể mã hóa nội dung chỉnh sửa tin nhắn.');
    }
  }, [emit, room]);

  const loadMore = async () => {
    const nextPage = page + 1;
    const res = await api.get(`/rooms/${room._id}/messages?page=${nextPage}&limit=30`);
    setMessages(prev => [...res.data, ...prev]);
    setPage(nextPage);
    setHasMore(res.data.length === 30);
  };

  if (!room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white text-gray-500 p-8 select-none">
        <span className="text-6xl mb-4 opacity-30">💬</span>
        <p className="text-lg font-bold text-gray-800">Chào mừng bạn đến với Chat App!</p>
        <p className="text-sm opacity-70 mt-1">Chọn một phòng chat hoặc Bạn bè ở sidebar để bắt đầu trò chuyện.</p>
      </div>
    );
  }

  const dmPartner = getDMPartner(room, user);
  const displayName = room.isDM
    ? (dmPartner?.nickname || dmPartner?.username || 'Người dùng Messenger')
    : room.name;

  const onlineMembers = !room.isDM ? (room.members?.filter(m => m.isOnline) || []) : [];
  const offlineMembers = !room.isDM ? (room.members?.filter(m => !m.isOnline) || []) : [];

  return (
    <div className="flex-1 flex flex-row h-full overflow-hidden bg-white text-black">
      {/* Vùng chat chính (giữa) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-white relative">
        
        {/* Header phòng chat — màu trắng Messenger */}
        <div className="h-[60px] border-b border-gray-200 px-4 flex items-center justify-between bg-white flex-shrink-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            {/* Nút quay lại Bạn bè */}
            <button 
              onClick={onBackToFriends}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer transition-colors text-base font-bold text-gray-600"
              title="Quay lại danh sách bạn bè"
            >
              ←
            </button>

            {/* Avatar Header & Tên */}
            <div 
              className={`flex items-center gap-3 min-w-0 ${room.isDM && dmPartner && onViewProfile ? 'cursor-pointer group' : ''}`}
              onClick={() => {
                if (room.isDM && dmPartner && onViewProfile) {
                  onViewProfile(dmPartner._id);
                }
              }}
            >
              <div className="relative flex-shrink-0">
                {room.isDM ? (
                  <div className="w-10 h-10 rounded-full bg-gray-200 text-white flex items-center justify-center font-bold text-sm overflow-hidden ring-1 ring-gray-100 group-hover:ring-[#0084ff] transition-all">
                    {dmPartner?.avatar ? (
                      <img src={dmPartner.avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[#0084ff] flex items-center justify-center text-white">
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#006aff] to-[#00b2ff] text-white flex items-center justify-center font-bold text-base">
                    💬
                  </div>
                )}
                {room.isDM && (
                  <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                    dmPartnerOnline ? 'bg-[#31a24c]' : 'bg-gray-400'
                  }`} />
                )}
              </div>

              <div className="flex flex-col leading-tight">
                <span className="font-bold text-gray-900 truncate text-[15px] group-hover:text-[#0084ff] transition-colors">{displayName}</span>
                <span className="text-[11px] text-gray-500 font-medium">
                  {room.isDM 
                    ? (dmPartnerOnline ? 'Đang hoạt động' : 'Không hoạt động') 
                    : `${room.members?.length || 0} thành viên`
                  }
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Nút mã an toàn E2EE & Nút gọi thoại 1-1 */}
            {room.isDM && dmPartner && (
              <>
                <button
                  onClick={() => setShowSafetyNumber(true)}
                  className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors text-base"
                  title="Mã An Toàn E2EE (Safety Number)"
                >
                  🔐
                </button>

                <button 
                  onClick={() => onInitiateCall && onInitiateCall(dmPartner._id, 'audio')}
                  className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors"
                  title="Bắt đầu cuộc gọi thoại"
                >
                  <svg className="w-5 h-5 text-[#0084ff]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                  </svg>
                </button>
                <button 
                  onClick={() => onInitiateCall(dmPartner, 'video')}
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-600 transition-colors cursor-pointer active:scale-95"
                  title="Gọi video"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </>
            )}
            
            {/* Nút bật/tắt Info Sidebar */}
            <button 
              onClick={() => setShowMembers(!showMembers)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-base cursor-pointer transition-colors ${showMembers ? 'bg-blue-50 text-[#0084ff]' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Thông tin cuộc trò chuyện"
            >
              ℹ️
            </button>
          </div>
        </div>

        {/* Danh sách tin nhắn */}
        <div 
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 hide-scrollbar bg-white"
        >
          {hasMore && (
            <button className="bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors self-center mb-4 text-xs font-semibold py-1.5 px-4 rounded-full shadow-xs cursor-pointer active:scale-95" onClick={loadMore}>
              Xem tin nhắn cũ hơn
            </button>
          )}
          
          <div className="flex flex-col gap-1.5">
            {messages.map((msg) => {
              return (
                <MessageItem
                  key={msg._id}
                  message={msg}
                  onReact={handleReact}
                  onReply={setReplyTo}
                  isGrouped={false}
                  isDM={room.isDM}
                  onForwardClick={handleForwardClick}
                  onEdit={handleEdit}
                  onViewProfile={onViewProfile}
                />
              );
            })}
          </div>
          
          {typing.length > 0 && (
            <p className="text-[11px] text-gray-400 italic mt-1 px-4">
              💬 {typing.join(', ')} đang nhập...
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {showScrollBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-6 w-10 h-10 rounded-full bg-white hover:bg-gray-50 border border-gray-200 shadow-md flex items-center justify-center text-gray-600 hover:text-[#0084ff] transition-all active:scale-95 cursor-pointer z-20 animate-bounce"
            title="Cuộn xuống dưới"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}

        {/* Ô nhập tin nhắn */}
        <div className="flex-shrink-0">
          <MessageInput
            onSend={handleSend}
            onTyping={handleTyping}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
      </div>

      {/* Cột 4: Thông tin cuộc trò chuyện bên phải (Messenger Details Sidebar) */}
      {showMembers && (
        <div className="w-[300px] bg-white flex flex-col border-l border-gray-200 flex-shrink-0">
          <div className="h-[60px] border-b border-gray-200 px-4 flex items-center bg-white font-bold text-gray-800 select-none flex-shrink-0 text-sm">
            Thông tin chi tiết
          </div>

          <div className="flex-1 overflow-y-auto hide-scrollbar p-4 flex flex-col items-center gap-6">
            {/* Ảnh đại diện phòng lớn ở cột thông tin */}
            <div 
              className={`flex flex-col items-center gap-2 mt-4 text-center ${room.isDM && dmPartner && onViewProfile ? 'cursor-pointer group' : ''}`}
              onClick={() => {
                if (room.isDM && dmPartner && onViewProfile) {
                  onViewProfile(dmPartner._id);
                }
              }}
            >
              {room.isDM ? (
                <div className="w-20 h-20 rounded-full bg-gray-200 text-white flex items-center justify-center font-bold text-3xl overflow-hidden ring-2 ring-gray-100 group-hover:ring-[#0084ff] transition-all">
                  {dmPartner?.avatar ? (
                    <img src={dmPartner.avatar} alt="avatar" className="w-20 h-20 rounded-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-[#0084ff] flex items-center justify-center text-white">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#006aff] to-[#00b2ff] text-white flex items-center justify-center font-bold text-4xl">
                  💬
                </div>
              )}
              <span className="font-bold text-lg text-gray-900 mt-2 group-hover:text-[#0084ff] transition-colors">{displayName}</span>
              {room.isDM && (
                <span className="text-xs text-gray-500">
                  {dmPartnerOnline ? 'Đang hoạt động trên Messenger' : 'Không hoạt động'}
                </span>
              )}
            </div>

            <div className="w-full h-[1px] bg-gray-100" />

            {/* Mục thành viên (Nếu không phải DM) */}
            {!room.isDM && (
              <div className="w-full flex flex-col gap-4">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">
                  Thành viên nhóm ({room.members?.length || 0})
                </h4>

                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto hide-scrollbar">
                  {/* Trực tuyến */}
                  {onlineMembers.map(m => (
                    <div 
                      key={m._id} 
                      onClick={() => onViewProfile && onViewProfile(m._id)}
                      className="flex items-center justify-between p-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-[#0084ff] text-white flex items-center justify-center font-bold text-sm overflow-hidden">
                            {m.avatar ? (
                              <img src={m.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <span>{(m.nickname || m.username)[0].toUpperCase()}</span>
                            )}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white bg-[#31a24c]" />
                        </div>
                        <span className="text-sm font-semibold truncate text-gray-800 group-hover:text-[#0084ff] transition-colors">{m.nickname || m.username}</span>
                      </div>
                    </div>
                  ))}

                  {/* Ngoại tuyến */}
                  {offlineMembers.map(m => (
                    <div 
                      key={m._id} 
                      onClick={() => onViewProfile && onViewProfile(m._id)}
                      className="flex items-center justify-between p-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors opacity-70 hover:opacity-100 group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center font-bold text-sm overflow-hidden">
                            {m.avatar ? (
                              <img src={m.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover filter grayscale" />
                            ) : (
                              <span>{(m.nickname || m.username)[0].toUpperCase()}</span>
                            )}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white bg-gray-400" />
                        </div>
                        <span className="text-sm font-semibold truncate text-gray-700 group-hover:text-[#0084ff] transition-colors">{m.nickname || m.username}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Modal chuyển tiếp tin nhắn */}
      <ForwardModal
        isOpen={showForward}
        onClose={() => setShowForward(false)}
        messageToForward={forwardTargetMessage}
        onForward={handleForwardSend}
      />
      {showSafetyNumber && room.isDM && dmPartner && (
        <SafetyNumberModal
          user={user}
          contactUser={dmPartner}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}
    </div>
  );
}