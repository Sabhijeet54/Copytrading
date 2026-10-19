import { redirect } from 'next/navigation';

/** Holdings / Orders are tabs of the Portfolio page now. */
export default function Page() {
  redirect('/portfolio/positions?tab=orders');
}
