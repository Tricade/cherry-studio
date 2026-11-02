import type { ReactNode } from 'react'

interface FallbackFaviconProps {
  hostname: string
  alt: string
  fallback?: ReactNode
}

const FallbackFavicon: React.FC<FallbackFaviconProps> = ({ hostname, alt, fallback }) => {
  return (
    fallback ?? (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className="inline-flex size-4 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
        {hostname.charAt(0).toUpperCase()}
      </span>
    )
  )
}

export default FallbackFavicon
