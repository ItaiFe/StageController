import { useState, useEffect, useCallback } from 'react';
import type { SongStats } from '../api';
import { statsApi } from '../api';
import './StatsPage.css';

interface Summary {
  total_plays: number;
  completed: number;
  skipped: number;
  stopped: number;
}

export function StatsPage() {
  const [stats, setStats] = useState<SongStats[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sortBy, setSortBy] = useState<'total' | 'completed' | 'skipped' | 'stopped'>('total');
  const [sortDesc, setSortDesc] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const [songStats, summaryData] = await Promise.all([
        statsApi.getAllSongs(),
        statsApi.getSummary(),
      ]);
      setStats(songStats);
      setSummary(summaryData);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const sortedStats = [...stats].sort((a, b) => {
    const diff = a[sortBy] - b[sortBy];
    return sortDesc ? -diff : diff;
  });

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(column);
      setSortDesc(true);
    }
  };

  const completionRate = summary && summary.total_plays > 0
    ? Math.round((summary.completed / summary.total_plays) * 100)
    : 0;

  return (
    <div className="stats-page">
      <div className="stats-header">
        <h2>Statistics</h2>
        <button className="refresh-btn" onClick={loadStats}>Refresh</button>
      </div>

      {summary && (
        <div className="stats-summary">
          <div className="summary-card">
            <span className="summary-value">{summary.total_plays}</span>
            <span className="summary-label">Total Plays</span>
          </div>
          <div className="summary-card completed">
            <span className="summary-value">{summary.completed}</span>
            <span className="summary-label">Completed</span>
          </div>
          <div className="summary-card skipped">
            <span className="summary-value">{summary.skipped}</span>
            <span className="summary-label">Skipped</span>
          </div>
          <div className="summary-card stopped">
            <span className="summary-value">{summary.stopped}</span>
            <span className="summary-label">Stopped</span>
          </div>
          <div className="summary-card rate">
            <span className="summary-value">{completionRate}%</span>
            <span className="summary-label">Completion Rate</span>
          </div>
        </div>
      )}

      {stats.length === 0 ? (
        <p className="empty">No play data yet. Start playing some songs!</p>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Song</th>
              <th>Artist</th>
              <th
                className={`sortable ${sortBy === 'completed' ? 'active' : ''}`}
                onClick={() => handleSort('completed')}
              >
                Completed {sortBy === 'completed' && (sortDesc ? '↓' : '↑')}
              </th>
              <th
                className={`sortable ${sortBy === 'skipped' ? 'active' : ''}`}
                onClick={() => handleSort('skipped')}
              >
                Skipped {sortBy === 'skipped' && (sortDesc ? '↓' : '↑')}
              </th>
              <th
                className={`sortable ${sortBy === 'stopped' ? 'active' : ''}`}
                onClick={() => handleSort('stopped')}
              >
                Stopped {sortBy === 'stopped' && (sortDesc ? '↓' : '↑')}
              </th>
              <th
                className={`sortable ${sortBy === 'total' ? 'active' : ''}`}
                onClick={() => handleSort('total')}
              >
                Total {sortBy === 'total' && (sortDesc ? '↓' : '↑')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedStats.map(song => (
              <tr key={song.song_id}>
                <td className="song-title">{song.title}</td>
                <td className="song-artist">{song.artist}</td>
                <td className="stat-completed">{song.completed}</td>
                <td className="stat-skipped">{song.skipped}</td>
                <td className="stat-stopped">{song.stopped}</td>
                <td className="stat-total">{song.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
