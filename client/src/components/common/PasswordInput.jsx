// Ô nhập password kèm icon con mắt để xem/ẩn nội dung — thay cho <input type="password">
// viết tay đang lặp lại ở nhiều form (đăng nhập, đăng ký, đổi mật khẩu, passphrase backup...).
// Nhận mọi prop như <input> thường (value, onChange, required, minLength...), className áp
// dụng trực tiếp lên input như cũ.
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative w-full">
      <input type={visible ? 'text' : 'password'} className={`${className} pr-9`} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(v => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content/70"
      >
        {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>
    </div>
  );
}
