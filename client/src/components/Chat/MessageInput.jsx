import { useState, useRef, useEffect } from 'react';
import api from '../../services/api';
import { scanLinksInText } from '../../utils/securityScan';

export default function MessageInput({ onSend, onTyping, replyTo, onCancelReply }) {
  const [content, setContent]   = useState('');
  const typingTimeout           = useRef(null);

  // States cho tính năng ghi âm
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const selectedFilesRef = useRef([]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const newFiles = files.map(file => {
      const isImage = file.type.startsWith('image/');
      return {
        id: Date.now() + Math.random(),
        file: file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        isImage: isImage
      };
    });

    setSelectedFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  };

  const removeSelectedFile = (idToRemove) => {
    setSelectedFiles(prev => {
      const item = prev.find(f => f.id === idToRemove);
      if (item && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter(f => f.id !== idToRemove);
    });
  };
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const handleChange = (e) => {
    setContent(e.target.value);
    onTyping(true);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 1500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const hasText = !!content.trim();
    const hasFiles = selectedFiles.length > 0;
    
    if (!hasText && !hasFiles) return;
    if (isSending) return;

    try {
      setIsSending(true);

      const imagesToSend = selectedFiles.filter(item => item.isImage);
      const otherFilesToSend = selectedFiles.filter(item => !item.isImage);
      setSelectedFiles([]); // Xóa danh sách preview nhanh chóng

      // 1. Gửi toàn bộ ảnh trước
      for (const item of imagesToSend) {
        try {
          const formData = new FormData();
          formData.append('image', item.file);

          const res = await api.post('/rooms/upload-image', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });

          onSend(res.data.url, replyTo?._id, 'image', item.file.name);

          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        } catch (err) {
          console.error(`Lỗi khi tải ảnh ${item.file.name}:`, err);
          alert(`Gửi ảnh ${item.file.name} thất bại.`);
        }
      }

      // 2. Gửi tin nhắn chữ tiếp theo (Có quét link bảo mật)
      if (hasText) {
        const trimmed = content.trim();
        const scanResult = scanLinksInText(trimmed);

        if (scanResult.hasWarning) {
          const warningMsg = scanResult.warnings.map(w => w.message).join('\n');
          const confirmSend = window.confirm(
            `⚠️ CẢNH BÁO AN TOÀN LIÊN KẾT:\n\n${warningMsg}\n\nBạn có chắc chắn vẫn muốn gửi tin nhắn này không?`
          );
          if (!confirmSend) {
            setIsSending(false);
            return;
          }
        }

        if (scanResult.urls.length > 0) {
          try {
            const { data } = await api.post('/security/check-link', { url: scanResult.urls[0] });
            if (data && !data.safe) {
              const confirmUnsafe = window.confirm(
                `⚠️ CẢNH BÁO BẢO MẬT: Liên kết (${scanResult.urls[0]}) đã bị đánh dấu nguy hiểm (${data.threatType || 'Độc hại'}).\n\nBạn có muốn HỦY gửi tin nhắn này không?`
              );
              if (confirmUnsafe) {
                setIsSending(false);
                return;
              }
            }
          } catch {
            // Graceful fallback
          }
        }

        onSend(trimmed, replyTo?._id, 'text');
        setContent('');
      }

      // 3. Gửi các file khác cuối cùng
      for (const item of otherFilesToSend) {
        try {
          const formData = new FormData();
          formData.append('file', item.file);

          const res = await api.post('/rooms/upload-file', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });

          onSend(res.data.url, replyTo?._id, 'file', item.file.name);

          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        } catch (err) {
          console.error(`Lỗi khi tải file ${item.file.name}:`, err);
          alert(`Gửi tệp ${item.file.name} thất bại.`);
        }
      }

      onTyping(false);
      clearTimeout(typingTimeout.current);
    } catch (err) {
      console.error('Lỗi khi gửi:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  // Bắt đầu ghi âm
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(10); // Lấy data mỗi 10ms

      setIsRecording(true);
      setRecordingTime(0);

      // Bắt đầu bộ đếm thời gian
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Không thể truy cập Microphone:', err);
      alert('Không thể truy cập microphone. Vui lòng kiểm tra quyền thiết bị.');
    }
  };

  // Hủy ghi âm
  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      // Dừng track âm thanh để tắt mic của thiết bị
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(timerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  // Hoàn tất ghi âm và gửi đi
  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current) return;

    const recorder = mediaRecorderRef.current;
    
    recorder.onstop = async () => {
      try {
        setIsUploading(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Tạo FormData để upload file
        const formData = new FormData();
        formData.append('audio', audioBlob, 'voice-message.webm');

        // Gửi API upload lên server -> Cloudinary
        const res = await api.post('/rooms/upload-audio', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        const audioUrl = res.data.url;

        // Gọi hàm onSend với type là 'audio'
        onSend(audioUrl, replyTo?._id, 'audio');

      } catch (err) {
        console.error('Lỗi khi tải tệp âm thanh lên:', err);
        alert('Gửi tin nhắn thoại thất bại. Vui lòng thử lại.');
      } finally {
        setIsUploading(false);
      }
    };

    // Dừng recorder (kích hoạt sự kiện onstop)
    recorder.stop();
    // Dừng track âm thanh để tắt mic
    recorder.stream.getTracks().forEach(track => track.stop());
    clearInterval(timerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
  };

  // Định dạng thời gian mm:ss
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Dọn dẹp bộ đếm khi unmount component
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      selectedFilesRef.current.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  return (
    <div className="px-4 py-3 bg-white flex flex-col gap-1 border-t border-gray-100">
      {replyTo && (
        <div className="flex justify-between items-center bg-[#f0f2f5] border-l-2 border-[#0084ff] rounded-lg px-3.5 py-1.5 text-xs text-gray-700 shadow-xs mb-1">
          <span>
            ↩ Đang trả lời <strong className="font-bold text-[#0084ff]">@{replyTo.sender.nickname || replyTo.sender.username}</strong>
          </span>
          <button onClick={onCancelReply} className="hover:text-black text-[10px] cursor-pointer font-bold px-2 py-0.5 rounded bg-gray-200">✕ Hủy</button>
        </div>
      )}

      {/* Danh sách tệp đính kèm chờ gửi */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-1 max-h-32 overflow-y-auto hide-scrollbar">
          {selectedFiles.map(item => (
            <div key={item.id} className="relative flex items-center bg-gray-100 border border-gray-200 rounded-lg p-1.5 max-w-[180px] shadow-3xs">
              {item.isImage ? (
                <img 
                  src={item.previewUrl} 
                  alt="preview" 
                  className="w-10 h-10 rounded-md object-cover" 
                />
              ) : (
                <div className="w-10 h-10 rounded-md bg-gray-200 flex items-center justify-center text-lg select-none">
                  📄
                </div>
              )}
              <div className="ml-2 flex-1 min-w-0 pr-4">
                <p className="text-[11px] font-semibold text-gray-700 truncate">{item.file.name}</p>
                <p className="text-[9px] text-gray-400">{(item.file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => removeSelectedFile(item.id)}
                className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-gray-400 hover:bg-red-500 text-white flex items-center justify-center text-[10px] font-bold shadow-xs cursor-pointer select-none transition-all active:scale-90"
                title="Xóa"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {isRecording ? (
        // Giao diện khi đang ghi âm
        <div className="flex items-center justify-between bg-[#ffebee] border border-[#ffcdd2] rounded-full px-4 py-2 text-red-600 font-semibold animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
            <span className="text-sm">Đang ghi âm...</span>
            <span className="ml-2 font-mono text-sm bg-red-100 text-red-700 px-2 py-0.5 rounded-md">{formatTime(recordingTime)}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Nút hủy ghi âm */}
            <button 
              type="button"
              onClick={cancelRecording}
              className="text-gray-500 hover:text-red-600 text-sm cursor-pointer select-none font-bold bg-white hover:bg-red-50 border border-gray-200 px-3 py-1 rounded-full shadow-2xs transition-colors"
              title="Hủy ghi âm"
            >
              🗑️ Hủy
            </button>

            {/* Nút gửi ghi âm */}
            <button 
              type="button"
              onClick={stopAndSendRecording}
              className="bg-red-600 hover:bg-red-700 text-white text-sm cursor-pointer select-none font-bold px-4 py-1 rounded-full shadow-sm active:scale-95 transition-all"
              disabled={isUploading}
            >
              {isUploading ? 'Đang gửi...' : '📤 Gửi'}
            </button>
          </div>
        </div>
      ) : (
        // Giao diện bình thường
        <form onSubmit={handleSubmit} className="flex items-center bg-[#f0f2f5] rounded-full px-4 py-2">
          {/* Nút cộng đính kèm */}
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[#0084ff] hover:text-[#006aff] font-black cursor-pointer text-base mr-3 transition-transform hover:scale-110 active:scale-95 select-none"
            disabled={isSending}
            title="Đính kèm ảnh/tệp tin"
          >
            ➕
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            multiple
          />

          {/* Nút Microphone */}
          <button 
            type="button"
            onClick={startRecording}
            className="mr-3 transition-transform hover:scale-110 active:scale-95 cursor-pointer select-none"
            title="Ghi âm thoại"
          >
            <svg className="w-6.5 h-6.5 drop-shadow-xs" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="micGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#09a6df" />
                  <stop offset="100%" stopColor="#2ac1b2" />
                </linearGradient>
              </defs>
              <circle cx="12" cy="12" r="12" fill="url(#micGrad)" />
              {/* Capsule */}
              <rect x="9.5" y="6.5" width="5" height="9" rx="2.5" stroke="white" strokeWidth="1.2" />
              {/* U-shape holder */}
              <path d="M7.5 11C7.5 13.5 9.5 15.5 12 15.5C14.5 15.5 16.5 13.5 16.5 11" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
              {/* Stand */}
              <path d="M12 15.5V18" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>

          <input
            className="bg-transparent border-none text-black placeholder-gray-500 text-sm focus:outline-none flex-1 w-full"
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Nhập tin nhắn... (Nhấn Enter để gửi)"
            autoFocus
            disabled={isSending}
          />

          {/* Nút gửi tin nhắn */}
          <button
            type="submit"
            className={`ml-2 text-sm font-bold cursor-pointer transition-colors ${
              (content.trim() || selectedFiles.length > 0) && !isSending
                ? 'text-[#0084ff] hover:text-[#006aff]' 
                : 'text-gray-400 cursor-not-allowed'
            }`}
            disabled={(!content.trim() && selectedFiles.length === 0) || isSending}
          >
            {isSending ? 'Đang gửi...' : 'Gửi'}
          </button>
        </form>
      )}
    </div>
  );
}