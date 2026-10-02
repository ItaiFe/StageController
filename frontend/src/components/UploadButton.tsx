import { useRef, useState } from 'react';
import { songsApi } from '../api';
import './UploadButton.css';

interface UploadButtonProps {
  onUploadComplete: () => void;
}

export function UploadButton({ onUploadComplete }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setProgress({ current: 0, total: files.length });

    try {
      if (files.length === 1) {
        await songsApi.upload(files[0]);
        setProgress({ current: 1, total: 1 });
      } else {
        for (let i = 0; i < files.length; i++) {
          await songsApi.upload(files[i]);
          setProgress({ current: i + 1, total: files.length });
        }
      }
      onUploadComplete();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
      setProgress({ current: 0, total: 0 });
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <button
        className={`upload-btn ${isUploading ? 'uploading' : ''}`}
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <span className="spinner" />
            Uploading {progress.current}/{progress.total}
          </>
        ) : (
          'Upload Songs'
        )}
      </button>
    </>
  );
}
