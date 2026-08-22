import { Avatar, Button, Card } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";

const RelCard = (props) => {

  let navigate = useNavigate();

  return (
    <Card.Root as={motion.div} whileHover={{ y: -3, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }} transition={{ duration: 0.2 }} width="320px">
      <Card.Body gap="2">
        <Avatar.Root size="lg" shape="rounded">
          {/* <Avatar.Image src="https://picsum.photos/200/300" /> */}
        {props.icon}
          {/* <Avatar.Fallback name="Nue Camp" /> */}
        </Avatar.Root>
        <Card.Title mt="2">{props.title}</Card.Title>
        <Card.Description>
          {props.description}
        </Card.Description>
      </Card.Body>
      <Card.Footer justifyContent="flex-end">
        <Button onClick={()=>{navigate(props.to)}}>
          {props.button}
        </Button>
      </Card.Footer>
    </Card.Root>
  )
}

export default RelCard
