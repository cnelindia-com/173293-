import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const orderId = params.get('orderId');

  return (
    <div className="container-app flex min-h-[60vh] items-center justify-center py-16">
      <div className="card max-w-lg w-full p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Payment successful</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your order is confirmed. We&apos;ll notify you as it progresses.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {orderId && (
            <Link to={`/orders/${orderId}`} className="btn-primary">
              Track order
            </Link>
          )}
          <Link to="/orders" className="btn-secondary">
            View orders
          </Link>
          <Link to="/restaurants" className="btn-ghost">
            Keep browsing
          </Link>
        </div>
      </div>
    </div>
  );
}
