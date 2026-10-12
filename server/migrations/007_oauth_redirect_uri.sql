-- The Google callback URL is now derived from the address the app is reached on (localhost dev,
-- localhost share, a deployed domain…) unless GOOGLE_REDIRECT_URI pins it. Each authorization
-- remembers the exact redirect_uri it started with, because the token exchange must repeat it.
alter table oauth_transactions add column redirect_uri text;
