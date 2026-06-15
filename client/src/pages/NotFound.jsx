import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center p-4">
      <h1 className="font-display text-8xl font-black text-primary">404</h1>
      <p className="font-display text-2xl font-bold mt-4">Page not found</p>
      <p className="text-muted-foreground mt-2">The page you're looking for doesn't exist or has been moved.</p>
      <Button asChild className="mt-6">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
