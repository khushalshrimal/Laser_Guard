import React, { useState } from 'react';
import {
  History,
  RefreshCw,
  Search,
  Download,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { BlackboxEvent } from '../../types/telemetry';

interface EventHistoryPageProps {
  events: BlackboxEvent[];
  isLoading: boolean;
  totalCount: number;
  onRefresh: (options?: { severity?: string }) => Promise<void>;
}

export const EventHistoryPage: React.FC<EventHistoryPageProps> = ({
  events,
  isLoading,
  totalCount,
  onRefresh,
}) => {
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('7d');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  const handleSeverityChange = (sev: string) => {
    setSelectedSeverity(sev);
    setCurrentPage(1);
    if (sev === 'ALL') {
      onRefresh({});
    } else {
      onRefresh({ severity: sev });
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (!searchTerm) return true;
    const matchMsg = ev.message.toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = ev.event_type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDevice = ev.device_id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchRule = (ev.rule_id || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchMsg || matchType || matchDevice || matchRule;
  });

  const totalPages = Math.ceil(filteredEvents.length / pageSize) || 1;
  const paginatedEvents = filteredEvents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(events, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `laserguard_blackbox_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchor.click();
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Action Bar */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-cyan-400" />
              Event History & Blackbox Audit Trail
            </h3>
            <p className="text-xs text-slate-400">
              Immutable timestamped log of safety transitions, rule activations, and connectivity events persisted in SQLite
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJSON}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 transition-colors"
              title="Download entire blackbox log as JSON"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export JSON</span>
            </button>

            <button
              onClick={() => onRefresh(selectedSeverity === 'ALL' ? {} : { severity: selectedSeverity })}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Reload</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by event type, rule ID, or message..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#080b12] border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Severity Filter Pills */}
            <div className="flex items-center rounded-lg bg-[#080b12] border border-slate-800 p-0.5 text-xs font-mono">
              {['ALL', 'CRITICAL', 'WARNING', 'NORMAL'].map((sev) => (
                <button
                  key={sev}
                  onClick={() => handleSeverityChange(sev)}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    selectedSeverity === sev
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Date Range Selector */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#080b12] border border-slate-800 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
        {isLoading ? (
          <div className="py-12 text-center text-xs font-mono text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
            Loading blackbox audit records from SQLite...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <Info className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-slate-300">No Events Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto font-mono">
              No matching blackbox records found in the database. Trigger scenarios in the simulator to record safety events.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-3">ID</th>
                    <th className="py-3 px-3">Time (UTC)</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Severity</th>
                    <th className="py-3 px-3">Details & Message</th>
                    <th className="py-3 px-3">Source</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {paginatedEvents.map((ev) => {
                    const sev = ev.severity || 'INFO';
                    return (
                      <tr key={ev.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 font-bold text-slate-500">#{ev.id}</td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-400">
                          {ev.timestamp.replace('T', ' ').slice(0, 19)}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-cyan-300 font-semibold">
                          {ev.event_type}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              sev === 'CRITICAL'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : sev === 'WARNING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {sev}
                          </span>
                        </td>
                        <td className="py-3 px-3 max-w-md">
                          <div className="text-white font-medium">{ev.message}</div>
                          {ev.rule_id && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Rule: <span className="text-slate-400">{ev.rule_id}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              ev.source === 'SIMULATOR'
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {ev.source}
                          </span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Resolved
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs font-mono text-slate-400">
              <div>
                Showing {(currentPage - 1) * pageSize + 1} to{' '}
                {Math.min(currentPage * pageSize, filteredEvents.length)} of {filteredEvents.length} events
                {totalCount > filteredEvents.length && ` (total ${totalCount} recorded)`}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      currentPage === pg
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {pg}
                  </button>
                ))}

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EventHistoryPage;
