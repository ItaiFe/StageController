import { useState } from 'react';
import './LoginPage.css';

interface LoginPageProps {
  onLogin: (password: string) => void;
  error?: string;
}

export function LoginPage({ onLogin, error }: LoginPageProps) {
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(password);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <span className="flamingo">🦩</span>
        </div>
        <h1 className="login-title">The Flamingods Stage</h1>
        <p className="login-subtitle">Enter password to continue</p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="password"
            className="login-input"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn">
            Enter Stage
          </button>
        </form>
      </div>

      <div className="login-bg">
        <div className="gradient-orb orb-1" />
        <div className="gradient-orb orb-2" />
        <div className="gradient-orb orb-3" />
      </div>
    </div>
  );
}
