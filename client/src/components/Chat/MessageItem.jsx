import { format } from 'date-fns';
import { useState, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import Toast from '../common/Toast';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import useTimedMessage from '../../hooks/useTimedMessage';
import ReportModal from './ReportModal';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

export default function MessageItem({ message, onReact, onReply, isDM, onForwardClick, onEdit, onViewProfile }) {
  const { user } = useAuth();
  const { emit } = useSocket();
  const isOwn = message.sender._id?.toString() === user._id?.toString();
  const senderName = message.sender.nickname || message.sender.username;

  const [showActions, setShowActions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [toastMsg, showToast] = useTimedMessage(2500);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
      .then(() => showToast('Đã sao chép tin nhắn vào bộ nhớ tạm'))
      .catch(err => console.error('Không thể sao chép:', err));
    setShowActions(false);
  };

  const handleRecall = () => {
    if (confirm('Bạn có chắc chắn muốn thu hồi tin nhắn này?')) {
      emit('message:delete', { messageId: message._id });
    }
    setShowActions(false);
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditValue(message.content);
    setShowActions(false);
  };

  const handleSaveEdit = () => {
    if (!editValue.trim()) return;
    if (onEdit) {
      onEdit(message._id, editValue);
    } else {
      emit('message:edit', { messageId: message._id, newContent: editValue });
    }
    setIsEditing(false);
  };

  const handleForward = () => {
    setShowActions(false);
    if (onForwardClick) onForwardClick(message);
  };

  const handleToggleActions = (e) => {
    e.stopPropagation();
    setShowActions(prev => !prev);
  };

  // Đóng dropdown menu khi click bất cứ đâu ngoài màn hình
  useEffect(() => {
    if (!showActions) return;
    const handleClose = () => setShowActions(false);
    document.addEventListener('click', handleClose);
    return () => document.removeEventListener('click', handleClose);
  }, [showActions]);

  // Cuộn mượt đến vị trí tin nhắn gốc được trả lời kèm hiệu ứng chớp tắt highlight
  const handleScrollToOriginal = () => {
    if (!message.replyTo?._id) return;
    const target = document.getElementById(`msg-${message.replyTo._id}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('bg-primary/10', 'ring-2', 'ring-primary/20', 'p-1');
      setTimeout(() => {
        target.classList.remove('bg-primary/10', 'ring-2', 'ring-primary/20', 'p-1');
      }, 1500);
    }
  };

  // Trường hợp tin nhắn đã bị xóa
  if (message.isDeleted) {
    return (
      <div id={`msg-${message._id}`} className={`flex flex-col mb-2 px-2 transition-all duration-300 rounded-lg ${isOwn ? 'items-end' : 'items-start'}`}>
        <div className="flex items-end gap-2">
          {!isOwn && (
            <div className="w-8 h-8 rounded-full bg-base-200 flex-shrink-0" />
          )}
          <div className={`chat-bubble chat-bubble-neutral text-xs italic text-base-content/40 bg-base-200 border border-base-300 ${
            isOwn ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'
          }`}>
            Tin nhắn đã bị thu hồi
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id={`msg-${message._id}`} className={`flex flex-col mb-2 px-2 transition-all duration-300 rounded-lg ${isOwn ? 'items-end' : 'items-start'}`}>
      
      {/* Nickname phía trên tin nhắn (nếu là phòng chat nhóm và không phải tin nhắn của mình) */}
      {!isOwn && !isDM && (
        <span
          onClick={() => onViewProfile && onViewProfile(message.sender._id)}
          className="text-[10px] text-base-content/50 font-semibold mb-0.5 ml-10 hover:underline cursor-pointer hover:text-primary transition-colors"
        >
          {senderName}
        </span>
      )}

      {/* Discord-style Reply Preview */}
      {message.replyTo && (
        <div
          onClick={handleScrollToOriginal}
          className={`flex items-center text-[11px] text-base-content/50 mb-1 select-none cursor-pointer hover:opacity-85 transition-opacity ${
            isOwn ? 'flex-row-reverse mr-2' : 'ml-4'
          }`}
          title="Cuộn tới tin nhắn gốc"
        >
          {/* Connector Line */}
          <div className={`w-6 h-3 border-t-2 border-base-300 flex-shrink-0 ${
            isOwn
              ? 'border-r-2 rounded-tr-md ml-1.5'
              : 'border-l-2 rounded-tl-md mr-1.5'
          }`} style={{ marginTop: '6px' }} />

          {/* Mini Avatar */}
          <div className="avatar">
            <div className="w-4 rounded-full bg-base-300 mr-1.5">
              {message.replyTo.sender?.avatar ? (
                <img src={message.replyTo.sender.avatar} alt="avatar" />
              ) : (
                <div className="w-full h-full bg-neutral text-[8px] text-neutral-content flex items-center justify-center font-bold">
                  {(message.replyTo.sender?.nickname || message.replyTo.sender?.username || 'U')[0].toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Replying target name */}
          <span className="font-bold text-base-content/70 mr-1.5 hover:underline">
            @{message.replyTo.sender?.nickname || message.replyTo.sender?.username}
          </span>

          {/* Snippet of content (optimized và ẩn Cloudinary URL) */}
          <span className="text-base-content/40 truncate max-w-[200px] italic">
            {message.replyTo.isDeleted ? 'Tin nhắn đã bị thu hồi' : (
              message.replyTo.type === 'audio' ? 'Tin nhắn thoại' :
              message.replyTo.type === 'image' ? '[Hình ảnh]' :
              message.replyTo.type === 'file' ? `[Tệp: ${message.replyTo.fileName || 'Tài liệu'}]` :
              message.replyTo.content
            )}
          </span>
        </div>
      )}

      {/* Nhãn chuyển tiếp tin nhắn */}
      {message.forwardedFrom && (
        <div className={`flex items-center text-[10px] text-base-content/40 gap-1 mb-0.5 select-none ${isOwn ? 'mr-2' : 'ml-10'}`}>
          <span>↪</span>
          <span>
            Chuyển tiếp từ{' '}
            <span className="font-semibold text-base-content/60">
              {message.forwardedFrom.sender?.nickname || message.forwardedFrom.sender?.username || 'Người dùng'}
            </span>
          </span>
        </div>
      )}

      {/* Hàng tin nhắn chính */}
      <div className={`flex items-end gap-2.5 max-w-full group/msg relative ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar người gửi (Chỉ hiện cho người khác) */}
        {!isOwn && (
          <div
            className="avatar flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => onViewProfile && onViewProfile(message.sender._id)}
          >
            <div className="w-8 rounded-full ring-1 ring-base-300" title={`Xem profile của ${senderName}`}>
              {message.sender.avatar ? (
                <img src={message.sender.avatar} alt="avatar" />
              ) : (
                <div className="w-full h-full bg-primary text-primary-content flex items-center justify-center font-bold text-xs">
                  <span>{senderName[0].toUpperCase()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bong bóng tin nhắn */}
        <div className="relative max-w-full">
          <div
            className={`text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-2xs ${
              message.type === 'audio' || message.type === 'image' || message.type === 'file'
                ? 'bg-transparent shadow-none'
                : isOwn
                  ? 'chat-bubble chat-bubble-primary rounded-2xl rounded-br-[4px] px-3.5 py-2 max-w-[min(75vw,26rem)]'
                  : 'chat-bubble bg-base-200 text-base-content rounded-2xl rounded-bl-[4px] px-3.5 py-2 max-w-[min(75vw,26rem)]'
            }`}
            title={format(new Date(message.createdAt), 'HH:mm')}
          >
            {message.type === 'audio' ? (
              <div className="relative inline-block">
                <audio
                  src={message.content}
                  controls
                  className={`w-[360px] max-w-full rounded-lg p-1 ${isOwn ? 'bg-primary/10' : 'bg-base-200'} focus:outline-none`}
                />
              </div>
            ) : message.type === 'image' ? (
              <div className="relative inline-block">
                <img
                  src={message.content}
                  alt="Hình ảnh đính kèm"
                  className="max-w-[240px] max-h-[240px] rounded-2xl cursor-pointer object-cover border border-base-300 shadow-xs hover:opacity-90 transition-opacity"
                  onClick={() => window.open(message.content, '_blank')}
                />
              </div>
            ) : message.type === 'file' ? (
              <div className={`flex items-center gap-3 rounded-2xl p-3.5 max-w-[240px] border shadow-3xs ${
                isOwn
                  ? 'bg-primary border-primary/70 text-primary-content'
                  : 'bg-base-200 border-base-300 text-base-content'
              }`}>
                <span className="text-2xl select-none">📄</span>
                <div className="flex flex-col min-w-0">
                  <a
                    href={message.content}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className={`text-[13px] font-semibold truncate hover:underline cursor-pointer ${
                      isOwn ? 'text-primary-content' : 'text-primary'
                    }`}
                    title={message.fileName || 'Tải file'}
                  >
                    {message.fileName || 'Tệp đính kèm'}
                  </a>
                  <span className={`text-[10px] font-medium mt-0.5 ${isOwn ? 'text-primary-content/70' : 'text-base-content/40'} flex items-center gap-1`}>
                    Tệp đính kèm
                  </span>
                </div>
              </div>
            ) : (
              isEditing ? (
                <div className="flex flex-col gap-1.5 min-w-[200px] py-1">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="textarea textarea-bordered textarea-xs w-full bg-base-100 text-base-content resize-none"
                    rows={2}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="btn btn-xs btn-ghost bg-base-200"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="btn btn-xs btn-primary text-white"
                    >
                      Lưu
                    </button>
                  </div>
                </div>
              ) : (
                <span>
                  {message.content}
                  {message.isEdited && (
                    <span 
                      className="text-[9px] opacity-60 ml-1.5 select-none font-medium text-inherit"
                      title="Tin nhắn đã qua chỉnh sửa"
                    >
                      (đã chỉnh sửa)
                    </span>
                  )}
                </span>
              )
            )}
          </div>

          {/* Reactions hiển thị nhỏ ở dưới chân bong bóng chat */}
          {message.reactions?.length > 0 && (
            <div className={`flex gap-0.5 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              {message.reactions.map(r => {
                const hasReacted = r.users.some(u => {
                  const uid = typeof u === 'object' && u !== null ? u._id : u;
                  return uid?.toString() === user._id?.toString();
                });
                
                const reactorNames = r.users
                  .map(u => (typeof u === 'object' && u !== null ? (u.nickname || u.username) : 'Người dùng'))
                  .join(', ');

                return (
                  <div key={r.emoji} className="relative group/react inline-block">
                    <button
                      className={`badge gap-1 cursor-pointer select-none active:scale-95 transition-all ${
                        hasReacted
                          ? 'badge-primary badge-outline'
                          : 'badge-ghost bg-base-200'
                      }`}
                      onClick={() => onReact(message._id, r.emoji)}
                    >
                      <span>{r.emoji}</span>
                      <span className="font-bold opacity-85">{r.users.length}</span>
                    </button>

                    {/* Tooltip hiển thị người bày tỏ cảm xúc */}
                    {reactorNames && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/react:flex flex-col items-center z-30">
                        <div className="bg-neutral text-neutral-content text-[9px] font-semibold px-2 py-1 rounded-md shadow-md whitespace-nowrap leading-tight text-center">
                          {reactorNames}
                        </div>
                        <div className="w-1.5 h-1.5 bg-neutral rotate-45 -mt-0.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Hover Menu thao tác (Emoji + Trả lời + Menu 3 chấm ⋮) */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 flex gap-0.5 bg-base-100 border border-base-300 shadow-sm p-1 rounded-full z-20 transition-all ${
            isOwn ? 'left-[-170px]' : 'right-[-170px]'
          } ${showActions ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 scale-95 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto group-hover/msg:scale-100'}`}
        >
          {EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => onReact(message._id, emoji)}
              className="btn btn-circle btn-ghost btn-xs text-xs"
            >
              {emoji}
            </button>
          ))}
          <button
            onClick={() => onReply(message)}
            className="btn btn-ghost btn-xs rounded-full text-base-content/60 hover:text-primary"
          >
            Reply
          </button>

          {/* Nút 3 chấm mở rộng hành động */}
          <div className="dropdown dropdown-top">
            <button
              tabIndex={0}
              onClick={handleToggleActions}
              className="btn btn-circle btn-ghost btn-xs"
              title="Thao tác khác"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {/* Dropdown Menu hành động */}
            {showActions && (
              <ul className={`dropdown-content menu menu-sm bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 min-w-[110px] z-30 ${
                isOwn ? 'right-0' : 'left-0'
              }`}>
                {message.type === 'text' && (
                  <li>
                    <button onClick={handleCopy} className="text-[11px] font-semibold">
                      Sao chép
                    </button>
                  </li>
                )}
                <li>
                  <button onClick={handleForward} className="text-[11px] font-semibold">
                    Chuyển tiếp
                  </button>
                </li>
                {isOwn && message.type === 'text' && (
                  <li>
                    <button onClick={handleStartEdit} className="text-[11px] font-semibold">
                      Chỉnh sửa
                    </button>
                  </li>
                )}
                {!isOwn && (
                  <li>
                    <button
                      onClick={() => {
                        setShowActions(false);
                        setShowReportModal(true);
                      }}
                      className="text-[11px] font-bold text-error"
                    >
                      🚩 Báo cáo
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

      </div>

      <Toast message={toastMsg} type="success" position="toast-bottom toast-center" alertClassName="text-xs py-2" />

      {showReportModal && (
        <ReportModal
          message={message}
          onClose={() => setShowReportModal(false)}
          onSuccess={(msg) => showToast(msg)}
        />
      )}
    </div>
  );
}