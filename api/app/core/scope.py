"""Which tracker accounts a user may see.

A non-admin user with users.account_group set only sees accounts in that
group, on every endpoint that returns or acts on account data. Admins and
users without a group see everything. Anything outside the scope answers
404, the same as an account that does not exist.
"""

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TrackerAccount
from app.models.user import User


def account_group(user: User) -> str | None:
    """The group this user is limited to, or None for full access."""
    if user.role == "admin":
        return None
    return (user.account_group or "").strip() or None


def scope_accounts(query: Select, user: User) -> Select:
    """Restrict a query that selects from tracker_accounts to the user's group."""
    group = account_group(user)
    return query.where(TrackerAccount.group_name == group) if group else query


async def visible_account_ids(db: AsyncSession, user: User) -> set[str] | None:
    """Ids the user may see, or None when the user sees every account."""
    if account_group(user) is None:
        return None
    rows = await db.execute(scope_accounts(select(TrackerAccount.id), user))
    return set(rows.scalars().all())


def can_see(account: TrackerAccount | None, user: User) -> bool:
    if account is None:
        return False
    group = account_group(user)
    return group is None or account.group_name == group


async def get_visible_account(db: AsyncSession, account_id: str, user: User) -> TrackerAccount:
    account = await db.get(TrackerAccount, account_id)
    if not can_see(account, user):
        raise HTTPException(404, "Hesap bulunamadı")
    return account
