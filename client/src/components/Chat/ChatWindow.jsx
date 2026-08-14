import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ShieldCheck, Phone, Video, Info, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import MessageItem from './MessageItem';
import MessageInput from './MessageInput';
import ForwardModal from './ForwardModal';
import SafetyNumberModal from './SafetyNumberModal';
import api from '../../services/api';
import { encryptMessageForRoom, decryptMessage, getDeviceId } from '../../utils/e2ee';
import useTimedMessage from '../../hooks/useTimedMessage';

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
  const [errorMsg, showError] = useTimedMessage();
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
      showError('Không thể mã hóa tin nhắn E2EE');
    }
  }, [emit, roomId, room, showError]);

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
      showError('Không thể chuyển tiếp tin nhắn đã bị thu hồi.');
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
      showError('Không thể mã hóa tin nhắn chuyển tiếp.');
    }
  }, [emit, showError]);

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
      showError('Không thể mã hóa nội dung chỉnh sửa tin nhắn.');
    }
  }, [emit, room, showError]);

  const loadMore = async () => {
    const nextPage = page + 1;
    const res = await api.get(`/rooms/${room._id}/messages?page=${nextPage}&limit=30`);
    setMessages(prev => [...res.data, ...prev]);
    setPage(nextPage);
    setHasMore(res.data.length === 30);
  };

  if (!room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base-100 text-base-content/60 p-8 select-none">
        <span className="text-6xl mb-4 opacity-30">💬</span>
        <p className="text-lg font-bold text-base-content">Chào mừng bạn đến với Chat App!</p>
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
    <div className="flex-1 flex flex-row h-full overflow-hidden bg-base-100 text-base-content relative">
      {errorMsg && (
        <div className="toast toast-top toast-center z-[100]">
          <div className="alert alert-error text-sm">
            <span>{errorMsg}</span>
          </div>
        </div>
      )}
      {/* Vùng chat chính (giữa) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-base-100 relative">

        {/* Header phòng chat */}
        <div className="h-[60px] border-b border-base-300 px-4 flex items-center justify-between bg-base-100 flex-shrink-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            {/* Nút quay lại Bạn bè */}
            <button
              onClick={onBackToFriends}
              className="btn btn-circle btn-ghost btn-sm bg-base-200"
              title="Quay lại danh sách bạn bè"
            >
              <ArrowLeft className="w-4 h-4" />
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
              {room.isDM ? (
                <div className={`avatar ${dmPartnerOnline ? 'avatar-online' : 'avatar-offline'} flex-shrink-0`}>
                  <div className="w-10 rounded-full ring-1 ring-base-300 group-hover:ring-primary transition-all">
                    {dmPartner?.avatar ? (
                      <img src={dmPartner.avatar} alt="avatar" />
                    ) : (
                      <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold">
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary text-primary-content flex items-center justify-center font-bold text-base flex-shrink-0">
                  💬
                </div>
              )}

              <div className="flex flex-col leading-tight">
                <span className="font-bold truncate text-[15px] group-hover:text-primary transition-colors">{displayName}</span>
                <span className="text-[11px] text-base-content/50 font-medium">
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
                  className="btn btn-circle btn-ghost btn-sm"
                  title="Mã An Toàn E2EE (Safety Number)"
                >
                  <ShieldCheck className="w-[18px] h-[18px]" />
                </button>

                <button
                  onClick={() => onInitiateCall && onInitiateCall(dmPartner._id, 'audio')}
                  className="btn btn-circle btn-ghost btn-sm text-primary"
                  title="Bắt đầu cuộc gọi thoại"
                >
                  <Phone className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => onInitiateCall(dmPartner, 'video')}
                  className="btn btn-circle btn-ghost btn-sm"
                  title="Gọi video"
                >
                  <Video className="w-[18px] h-[18px]" />
                </button>
              </>
            )}

            {/* Nút bật/tắt Info Sidebar */}
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`btn btn-circle btn-ghost btn-sm ${showMembers ? 'bg-primary/10 text-primary' : ''}`}
              title="Thông tin cuộc trò chuyện"
            >
              <Info className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Danh sách tin nhắn */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 hide-scrollbar bg-base-100"
        >
          {hasMore && (
            <button className="btn btn-sm btn-ghost bg-base-200 self-center mb-4 rounded-full" onClick={loadMore}>
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
            <p className="text-[11px] text-base-content/40 italic mt-1 px-4">
              💬 {typing.join(', ')} đang nhập...
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {showScrollBottom && (
          <button
            onClick={scrollToBottom}
            className="btn btn-circle btn-sm bg-base-100 border-base-300 shadow-md absolute bottom-20 right-6 text-base-content/60 hover:text-primary z-20 animate-bounce"
            title="Cuộn xuống dưới"
          >
            <ChevronDown className="w-5 h-5" />
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

      {/* Cột 4: Thông tin cuộc trò chuyện bên phải */}
      {showMembers && (
        <div className="w-[300px] bg-base-100 flex flex-col border-l border-base-300 flex-shrink-0">
          <div className="h-[60px] border-b border-base-300 px-4 flex items-center font-bold select-none flex-shrink-0 text-sm">
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
                <div className="avatar">
                  <div className="w-20 rounded-full ring-2 ring-base-300 group-hover:ring-primary transition-all">
                    {dmPartner?.avatar ? (
                      <img src={dmPartner.avatar} alt="avatar" />
                    ) : (
                      <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold text-3xl">
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-primary to-secondary text-primary-content flex items-center justify-center font-bold text-4xl">
                  💬
                </div>
              )}
              <span className="font-bold text-lg mt-2 group-hover:text-primary transition-colors">{displayName}</span>
              {room.isDM && (
                <span className="text-xs text-base-content/50">
                  {dmPartnerOnline ? 'Đang hoạt động' : 'Không hoạt động'}
                </span>
              )}
            </div>

            <div className="divider my-0 w-full" />

            {/* Mục thành viên (Nếu không phải DM) */}
            {!room.isDM && (
              <div className="w-full flex flex-col gap-4">
                <h4 className="text-xs font-bold text-base-content/50 uppercase tracking-wider px-1">
                  Thành viên nhóm ({room.members?.length || 0})
                </h4>

                <ul className="menu menu-sm p-0 gap-1 max-h-64 overflow-y-auto hide-scrollbar flex-nowrap">
                  {/* Trực tuyến */}
                  {onlineMembers.map(m => (
                    <li key={m._id}>
                      <a onClick={() => onViewProfile && onViewProfile(m._id)} className="group">
                        <div className="avatar avatar-online">
                          <div className="w-8 rounded-full">
                            {m.avatar ? (
                              <img src={m.avatar} alt="avatar" />
                            ) : (
                              <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold text-sm">
                                {(m.nickname || m.username)[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{m.nickname || m.username}</span>
                      </a>
                    </li>
                  ))}

                  {/* Ngoại tuyến */}
                  {offlineMembers.map(m => (
                    <li key={m._id} className="opacity-70 hover:opacity-100">
                      <a onClick={() => onViewProfile && onViewProfile(m._id)} className="group">
                        <div className="avatar avatar-offline">
                          <div className="w-8 rounded-full">
                            {m.avatar ? (
                              <img src={m.avatar} alt="avatar" className="grayscale" />
                            ) : (
                              <div className="w-full h-full bg-base-300 flex items-center justify-center text-base-content font-bold text-sm">
                                {(m.nickname || m.username)[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{m.nickname || m.username}</span>
                      </a>
                    </li>
                  ))}
                </ul>
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