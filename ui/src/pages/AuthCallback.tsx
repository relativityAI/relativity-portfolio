import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Center, Spinner } from "@chakra-ui/react";
import { useAuth } from "@/auth/useAuth";

export default function AuthCallback() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (loading) return;
        navigate(user ? "/" : "/login", { replace: true });
    }, [loading, user, navigate]);

    return (
        <Center minH="calc(100vh - 56px)">
            <Spinner size="lg" />
        </Center>
    );
}
