import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message || 'Unknown error' };
  }

  handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' }, () => {
      try {
        if (typeof window !== 'undefined') {
          window.location.replace(window.location.origin + '/');
        }
      } catch {
        try {
          window.location.reload();
        } catch {
          // State already reset so children re-render cleanly
        }
      }
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-[100dvh] w-full overflow-y-auto overscroll-none bg-[#020617] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 p-6 text-center space-y-4">
            <h2 className="text-lg font-semibold text-white">কিছু একটা সমস্যা হয়েছে</h2>
            <p className="text-sm text-slate-400 break-words">
              অ্যাপটি পুনরায় লোড করার জন্য নিচের বাটনে চাপ দিন।
            </p>
            <button
              type="button"
              onClick={this.handleRecover}
              className="w-full py-3 px-4 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 active:scale-[0.98] transition"
            >
              পুনরায় চেষ্টা করুন
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
