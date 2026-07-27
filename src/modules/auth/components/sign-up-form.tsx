"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/modules/auth/actions";
import { signUpSchema, type SignUpInput } from "@/modules/auth/schemas";

/**
 * Self-service registration always creates a FAMILY account (caregivers and
 * operations staff are provisioned separately). No role field is offered or
 * accepted, and the server ignores any client attempt to set one.
 */
export function SignUpForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", displayName: "", accountName: "" },
  });

  function onSubmit(values: SignUpInput) {
    setFormError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await signUpAction(values);
      if (result?.error) setFormError(result.error);
      else if (result?.notice) setNotice(result.notice);
    });
  }

  if (notice) {
    return (
      <Alert role="status">
        <AlertDescription>{notice}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="displayName">Your name</Label>
        <Input
          id="displayName"
          autoComplete="name"
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={errors.displayName ? "displayName-error" : undefined}
          {...register("displayName")}
        />
        {errors.displayName ? (
          <p id="displayName-error" className="text-sm text-destructive">
            {errors.displayName.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="accountName">Family account name</Label>
        <Input
          id="accountName"
          autoComplete="off"
          placeholder="e.g. The Rivera family"
          aria-invalid={Boolean(errors.accountName)}
          {...register("accountName")}
        />
        <p className="text-sm text-muted-foreground">Optional. You can change this later.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
        {errors.email ? (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        {errors.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {errors.password.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">At least 8 characters.</p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
