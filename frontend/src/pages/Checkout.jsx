import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import toast from 'react-hot-toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import PageCloseButton from '../components/ui/PageCloseButton';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { orderService } from '../services/orderService';
import { paymentService } from '../services/paymentService';
import { promoService } from '../services/promoService';
import { authService } from '../services/authService';
import { DEFAULT_DELIVERY_FEE, TAX_RATE } from '../utils/constants';
import { formatPrice, getErrorMessage } from '../utils/formatPrice';

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim();
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

function PaymentForm({ orderId, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handlePay = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });
      if (error) {
        toast.error(error.message || 'Payment failed');
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        await paymentService.confirm({
          orderId,
          paymentIntentId: paymentIntent.id,
        });
        onSuccess?.(paymentIntent.id);
      } else {
        toast.error('Payment was not completed');
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Payment failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <PaymentElement />
      <Button type="submit" loading={loading} className="w-full" disabled={!stripe}>
        Pay now
      </Button>
    </form>
  );
}

export default function Checkout() {
  const { user, refreshUser } = useAuth();
  const { cart, fetchCart } = useCart();
  const navigate = useNavigate();
  const [deliveryType, setDeliveryType] = useState('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [deliveryWindow, setDeliveryWindow] = useState('30');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({
    label: 'Home',
    street: '',
    city: '',
    state: '',
    zip: '',
    isDefault: true,
  });
  const [step, setStep] = useState('details');
  const [order, setOrder] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [placing, setPlacing] = useState(false);
  const [payMethod, setPayMethod] = useState('cod');
  const [stripeEnabled, setStripeEnabled] = useState(false);

  useEffect(() => {
    paymentService
      .getConfig()
      .then((cfg) => {
        const enabled = Boolean(cfg?.stripeEnabled && cfg?.publishableKey);
        setStripeEnabled(enabled);
        if (!enabled) setPayMethod('cod');
      })
      .catch(() => {
        setStripeEnabled(false);
        setPayMethod('cod');
      });
  }, []);

  const addresses = user?.addresses || [];

  useEffect(() => {
    if (!addresses.length) {
      setShowNewAddress(true);
      return;
    }
    const def = addresses.find((a) => a.isDefault) || addresses[0];
    setSelectedAddressId(def?._id || '');
  }, [addresses]);

  const totals = useMemo(() => {
    const subtotal = cart.subtotal || 0;
    const deliveryFee = cart.restaurant?.deliveryFee ?? DEFAULT_DELIVERY_FEE;
    const discountAmount = Number(appliedPromo?.discountAmount || 0);
    const taxable = Math.max(subtotal - discountAmount, 0);
    const tax = Math.round(taxable * TAX_RATE * 100) / 100;
    const total = Math.round((taxable + Number(deliveryFee) + tax) * 100) / 100;
    const etaMinutes = deliveryType === 'scheduled' ? null : 35;
    return { subtotal, deliveryFee, discountAmount, tax, total, etaMinutes };
  }, [cart, appliedPromo, deliveryType]);

  const applyPromo = async () => {
    if (!promoCode.trim()) {
      toast.error('Enter a promo code');
      return;
    }
    setPromoLoading(true);
    try {
      const data = await promoService.validate({
        code: promoCode.trim(),
        subtotal: cart.subtotal || 0,
      });
      setAppliedPromo(data);
      toast.success(`${data.code} applied (−${formatPrice(data.discountAmount)})`);
    } catch (error) {
      setAppliedPromo(null);
      toast.error(getErrorMessage(error, 'Invalid promo code'));
    } finally {
      setPromoLoading(false);
    }
  };

  if (!cart.items?.length && step === 'details') {
    return (
      <div className="container-app py-10">
        <EmptyState
          title="Nothing to checkout"
          description="Add items to your cart first."
          actionLabel="Browse restaurants"
          onAction={() => navigate('/restaurants')}
        />
      </div>
    );
  }

  const resolveAddress = () => {
    if (showNewAddress || !selectedAddressId) {
      return newAddress;
    }
    return addresses.find((a) => a._id === selectedAddressId);
  };

  const placeOrder = async () => {
    const address = resolveAddress();
    if (!address?.street || !address?.city || !address?.state || !address?.zip) {
      toast.error('Please provide a complete delivery address');
      return;
    }
    if (deliveryType === 'scheduled' && (!scheduledDate || !scheduledTime)) {
      toast.error('Select a date and time for scheduled delivery');
      return;
    }

    setPlacing(true);
    try {
      if (showNewAddress || !selectedAddressId) {
        await authService.addAddress(address);
        await refreshUser();
      }

      const created = await orderService.create({
        deliveryAddress: {
          label: address.label,
          street: address.street,
          city: address.city,
          state: address.state,
          zip: address.zip,
        },
        deliveryType,
        scheduledDate: deliveryType === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: deliveryType === 'scheduled' ? scheduledTime : undefined,
        deliveryWindow:
          deliveryType === 'scheduled' ? `${deliveryWindow} min window` : undefined,
        specialInstructions,
        promoCode: appliedPromo?.code || promoCode || undefined,
      });

      const orderData = created?.order || created;
      setOrder(orderData);
      await fetchCart();

      if (payMethod === 'cod' || !stripeEnabled) {
        await paymentService.payCod({ orderId: orderData._id });
        toast.success('Order confirmed · pay on delivery');
        navigate(`/payment/success?orderId=${orderData._id}&method=cod`);
        return;
      }

      const intent = await paymentService.createIntent({
        orderId: orderData._id,
      });
      const secret = intent?.clientSecret || intent?.client_secret;
      if (!secret) {
        throw new Error('Card payment unavailable. Choose Cash on Delivery.');
      }
      setClientSecret(secret);
      setStep('payment');
      toast.success('Order created — complete card payment');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not place order'));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="container-app py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold text-slate-900">Checkout</h1>
        <PageCloseButton fallbackTo="/cart" label="Close checkout" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {step === 'details' && (
            <>
              <section className="card space-y-4 p-5">
                <h2 className="text-lg font-semibold text-slate-900">Delivery address</h2>
                {addresses.length > 0 && (
                  <div className="space-y-2">
                    {addresses.map((addr) => (
                      <label
                        key={addr._id}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                          selectedAddressId === addr._id && !showNewAddress
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-slate-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="address"
                          checked={selectedAddressId === addr._id && !showNewAddress}
                          onChange={() => {
                            setSelectedAddressId(addr._id);
                            setShowNewAddress(false);
                          }}
                        />
                        <span className="text-sm">
                          <span className="font-semibold">{addr.label}</span>
                          <br />
                          {addr.street}, {addr.city}, {addr.state} {addr.zip}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="text-sm font-semibold text-brand-600"
                  onClick={() => setShowNewAddress(true)}
                >
                  + Add new address
                </button>
                {showNewAddress && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Label"
                      value={newAddress.label}
                      onChange={(e) =>
                        setNewAddress((a) => ({ ...a, label: e.target.value }))
                      }
                    />
                    <Input
                      label="Street"
                      required
                      value={newAddress.street}
                      onChange={(e) =>
                        setNewAddress((a) => ({ ...a, street: e.target.value }))
                      }
                    />
                    <Input
                      label="City"
                      required
                      value={newAddress.city}
                      onChange={(e) =>
                        setNewAddress((a) => ({ ...a, city: e.target.value }))
                      }
                    />
                    <Input
                      label="State"
                      required
                      value={newAddress.state}
                      onChange={(e) =>
                        setNewAddress((a) => ({ ...a, state: e.target.value }))
                      }
                    />
                    <Input
                      label="ZIP"
                      required
                      value={newAddress.zip}
                      onChange={(e) =>
                        setNewAddress((a) => ({ ...a, zip: e.target.value }))
                      }
                    />
                  </div>
                )}
              </section>

              <section className="card space-y-4 p-5">
                <h2 className="text-lg font-semibold text-slate-900">Delivery time</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { value: 'now', label: 'Deliver now' },
                    { value: 'scheduled', label: 'Schedule' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDeliveryType(opt.value)}
                      className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                        deliveryType === opt.value
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {deliveryType === 'scheduled' && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      label="Date"
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                    />
                    <Input
                      label="Time"
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-slate-700">
                        Window
                      </label>
                      <select
                        className="input-field"
                        value={deliveryWindow}
                        onChange={(e) => setDeliveryWindow(e.target.value)}
                      >
                        <option value="15">15 min</option>
                        <option value="30">30 min</option>
                        <option value="45">45 min</option>
                        <option value="60">60 min</option>
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Order notes
                  </label>
                  <textarea
                    className="input-field resize-none"
                    rows={3}
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="Gate code, leave at door..."
                  />
                </div>
              </section>

              <section className="card space-y-3 p-5">
                <h2 className="text-lg font-semibold text-slate-900">Promo code</h2>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="e.g. WELCOME15"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value.toUpperCase());
                      setAppliedPromo(null);
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    loading={promoLoading}
                    onClick={applyPromo}
                  >
                    Apply
                  </Button>
                </div>
                {appliedPromo && (
                  <p className="text-sm font-medium text-emerald-700">
                    {appliedPromo.title || appliedPromo.code}: −
                    {formatPrice(appliedPromo.discountAmount)}
                  </p>
                )}
              </section>

              <section className="card space-y-3 p-5">
                <h2 className="text-lg font-semibold text-slate-900">Payment method</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('cod')}
                    className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
                      payMethod === 'cod'
                        ? 'border-brand-500 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Cash on Delivery
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Pay when your order arrives
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => stripeEnabled && setPayMethod('card')}
                    disabled={!stripeEnabled}
                    className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
                      payMethod === 'card'
                        ? 'border-brand-500 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-600'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Pay by Card (Stripe)
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      {stripeEnabled
                        ? 'Secure Stripe test/live card payment'
                        : 'Add Stripe test keys in backend + frontend .env to enable'}
                    </span>
                  </button>
                </div>
                {!stripeEnabled && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Stripe is not configured yet. Use Cash on Delivery for now, or set
                    <code className="mx-1">STRIPE_SECRET_KEY</code> /
                    <code className="mx-1">STRIPE_PUBLISHABLE_KEY</code> in
                    <code className="mx-1">backend/.env</code> and
                    <code className="mx-1">VITE_STRIPE_PUBLISHABLE_KEY</code> in
                    <code className="mx-1">frontend/.env</code>, then restart both servers.
                  </p>
                )}
              </section>

              <Button loading={placing} onClick={placeOrder} className="w-full sm:w-auto">
                {payMethod === 'cod' ? 'Place order' : 'Place order & pay'}
              </Button>
            </>
          )}

          {step === 'payment' && (
            <section className="card p-5">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Card payment</h2>
              {!clientSecret ? (
                <Spinner label="Preparing payment..." />
              ) : (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: { theme: 'stripe', variables: { colorPrimary: '#ea580c' } },
                  }}
                >
                  <PaymentForm
                    orderId={order?._id}
                    onSuccess={(pi) =>
                      navigate(`/payment/success?orderId=${order?._id}&payment_intent=${pi}`)
                    }
                  />
                </Elements>
              )}
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={async () => {
                  try {
                    await paymentService.payCod({ orderId: order._id });
                    navigate(`/payment/success?orderId=${order._id}&method=cod`);
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                  }
                }}
              >
                Switch to Cash on Delivery
              </Button>
            </section>
          )}
        </div>

        <aside className="card h-fit space-y-3 p-5">
          <h2 className="font-semibold text-slate-900">Summary</h2>
          {(cart.items || order?.items || []).map((item) => (
            <div key={item._id || item.name} className="flex justify-between text-sm">
              <span className="text-slate-600">
                {item.quantity}× {item.name}
              </span>
              <span>
                {formatPrice(
                  (Number(item.price) +
                    (item.addOns || []).reduce((s, a) => s + Number(a.price || 0), 0)) *
                    Number(item.quantity)
                )}
              </span>
            </div>
          ))}
          <div className="border-t border-slate-100 pt-3 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatPrice(order?.subtotal ?? totals.subtotal)}</span>
            </div>
            {(Number(order?.discountAmount) > 0 || totals.discountAmount > 0) && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount</span>
                <span>
                  −{formatPrice(order?.discountAmount ?? totals.discountAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Delivery</span>
              <span>{formatPrice(order?.deliveryFee ?? totals.deliveryFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Tax</span>
              <span>{formatPrice(order?.tax ?? totals.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="text-brand-700">
                {formatPrice(order?.total ?? totals.total)}
              </span>
            </div>
            {step === 'details' && totals.etaMinutes && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700">
                Estimated delivery ~{totals.etaMinutes} minutes after payment
              </p>
            )}
            {order?.estimatedDeliveryAt && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700">
                ETA saved on order
              </p>
            )}
          </div>
          <Link to="/cart" className="btn-ghost w-full justify-center text-sm">
            Edit cart
          </Link>
        </aside>
      </div>
    </div>
  );
}
