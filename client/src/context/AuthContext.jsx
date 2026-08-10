/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { getDeviceId, getPrivateKey, getPublicKey, generateKeyPair, storePrivateKey, storePublicKey, exportPublicKey, exportPublicKeyFromPrivateKey } from '../utils/e2ee';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(!!sessionStorage.getItem('token'));
  const [needDevicePassword, setNeedDevicePassword] = useState(false);

  // Helper đảm bảo thiết bị hiện tại được tạo và đăng ký E2EE Key
  const initDeviceKey = async (currentPassword) => {
    const deviceId = getDeviceId();
    let privateKey = await getPrivateKey(deviceId);
    let publicKeyJWK = '';

    if (!privateKey) {
      const keyPair = await generateKeyPair();
      privateKey = keyPair.privateKey;
      await storePrivateKey(deviceId, privateKey);
      publicKeyJWK = await exportPublicKey(keyPair.publicKey);
      await storePublicKey(deviceId, publicKeyJWK);
    } else {
      const storedPublicKey = await getPublicKey(deviceId);
      if (storedPublicKey) {
        publicKeyJWK = storedPublicKey;
      } else {
        try {
          publicKeyJWK = await exportPublicKeyFromPrivateKey(privateKey);
          await storePublicKey(deviceId, publicKeyJWK);
        } catch (err) {
          console.warn('[E2EE] Cannot recover public key from private key:', err);
          throw new Error('Public key thiết bị bị thiếu. Vui lòng khôi phục backup hoặc đăng ký lại thiết bị.');
        }
      }
    }

    const deviceName = `${navigator.platform} (${navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Browser'})`;

    // Gọi API đăng ký/gia hạn thiết bị với mật khẩu xác nhận
    const { data } = await api.put('/auth/devices', {
      deviceId,
      publicKey: publicKeyJWK,
      deviceName,
      currentPassword,
    });

    // Cập nhật Device Token mới vào sessionStorage
    if (data.token) {
      sessionStorage.setItem('token', data.token);
    }

    return data;
  };

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    api.get('/auth/me')
      .then(res => setUser(res.data))
      .catch((err) => {
        if (err.response?.data?.code === 'DEVICE_SESSION_INVALID') {
          sessionStorage.removeItem('token');
          setUser(null);
        } else {
          sessionStorage.removeItem('token');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    sessionStorage.setItem('token', data.token);
    setUser(data.user);

    // Tự động kích hoạt luồng đăng ký thiết bị với mật khẩu vừa nhập
    try {
      await initDeviceKey(password);
    } catch (err) {
      console.warn('[E2EE] Initial device registration warning:', err);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, initDeviceKey, needDevicePassword, setNeedDevicePassword }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);