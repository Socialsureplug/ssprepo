import { Link } from 'react-router-dom';
import { buttonVariants } from '@app/ui';

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-32 text-center">
      <div className="eyebrow">404</div>
      <h1 className="display mt-3 text-[52px] text-ink">This page doesn't exist.</h1>
      <p className="mt-3 text-[15px] text-muted">Check the address, or head back to the homepage.</p>
      <Link to="/" className={buttonVariants({ className: 'mt-8' })}>Go home</Link>
    </div>
  );
}
